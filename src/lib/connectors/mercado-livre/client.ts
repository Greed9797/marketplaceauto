import type { InventoryRow } from "@/lib/connectors/inventory";
import { callWithRetry } from "@/lib/connectors/retry";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";
import { redirectSafeFetch } from "@/lib/connectors/url-guard";

import {
  MERCADO_LIVRE_DEFAULT_API_BASE_URL,
  type MercadoLivreConfig,
} from "./oauth";

type FetchLike = typeof fetch;

/** ML returns 50 orders per page on /orders/search (the API hard cap). */
export const MERCADO_LIVRE_ORDERS_PAGE_SIZE = 50;

/** Page-to-page delay (ms) to stay within Mercado Livre's request rate-limit. */
const MERCADO_LIVRE_PAGE_THROTTLE_MS = 1100;

type MercadoLivreTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  user_id?: string | number;
};

export type MercadoLivreToken = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  /** Seller id (Mercado Livre `user_id`). */
  userId: string;
  /** Token lifetime in seconds (~21600 = 6h). */
  expiresIn: number;
};

type MercadoLivrePayment = {
  status?: string | null;
};

type MercadoLivreOrderItem = {
  item?: {
    id?: string | number | null;
    title?: string | null;
    seller_sku?: string | null;
  } | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
};

type MercadoLivreStatePayload = {
  id?: string | null; // "BR-SC"
  name?: string | null; // "Santa Catarina"
} | null;

type MercadoLivreOrderPayload = {
  id?: string | number;
  status?: string | null;
  total_amount?: number | string | null;
  currency_id?: string | null;
  date_created?: string | null;
  date_closed?: string | null;
  date_approved?: string | null;
  buyer?: { email?: string | null } | null;
  payments?: MercadoLivrePayment[] | null;
  order_items?: MercadoLivreOrderItem[] | null;
  // No JSON atual de orders, shipping traz SÓ o id — o endereço vive em
  // GET /shipments/{id}. receiver_address embutido é o formato legado; quando
  // presente, é usado como fast-path pra evitar a chamada extra.
  shipping?: {
    id?: string | number | null;
    receiver_address?: { state?: MercadoLivreStatePayload } | null;
  } | null;
};

type MercadoLivreOrdersResponse = {
  results?: MercadoLivreOrderPayload[];
  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };
};

type MercadoLivreUserResponse = {
  nickname?: string | null;
  first_name?: string | null;
};

const MELI_REFUND_PAYMENT_STATUSES = new Set<string>([
  "refunded",
  "charged_back",
]);

export class MercadoLivreApiError extends Error {
  status: number;
  body: string;
  response: {
    status: number;
    headers: Headers;
  };

  constructor(status: number, body: string, headers = new Headers()) {
    super(`Mercado Livre API request failed with status ${status}`);
    this.name = "MercadoLivreApiError";
    this.status = status;
    this.body = body;
    this.response = { status, headers };
  }
}

async function fetchJson<T>(
  url: URL | string,
  fetchImpl: FetchLike,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new MercadoLivreApiError(response.status, body, response.headers);
  }

  return JSON.parse(body) as T;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function asAmount(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? String(amount) : "0";
}

function asCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? count : 1;
}

/**
 * Returns the first input that parses as a real Date, in ISO string form. ML
 * occasionally returns null/empty timestamps on incomplete orders; "" lets the
 * downstream parsePlacedAt guard SKIP the order instead of dating it to now().
 */
function pickValidIsoDate(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ts = Date.parse(candidate);
    if (Number.isFinite(ts)) {
      return new Date(ts).toISOString();
    }
  }
  return "";
}

/**
 * Mercado Livre order → canonical ShopifyOrder.
 *
 * Status normalization happens HERE (not at the metric layer): a refunded /
 * charged-back payment must emit "refunded" so the generic isApprovedOrderStatus
 * filter — which only sees the string `status` — excludes it. A `paid` order
 * with no refund maps to "paid"; anything else passes its own status through.
 * Total = `total_amount` (the order total already returned by the API); we never
 * sum `payments[]` because that double-counts installment/multi-payment orders.
 */
export function normalizeMercadoLivreOrder(
  order: MercadoLivreOrderPayload,
): ShopifyOrder {
  const externalOrderId = String(order.id ?? "");
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const hasRefund = payments.some((payment) =>
    MELI_REFUND_PAYMENT_STATUSES.has(payment?.status ?? ""),
  );
  const status = hasRefund
    ? "refunded"
    : order.status === "paid"
      ? "paid"
      : (order.status ?? "unknown");

  const items = (order.order_items ?? []).map((orderItem, index) => {
    const quantity = asCount(orderItem.quantity);
    const unitPrice = Number(orderItem.unit_price);
    const lineTotal = Number.isFinite(unitPrice) ? unitPrice * quantity : 0;
    const itemId = orderItem.item?.id;

    return {
      productName: orderItem.item?.title ?? `Produto ${index + 1}`,
      sku:
        orderItem.item?.seller_sku ??
        (itemId === undefined || itemId === null ? null : String(itemId)),
      quantity,
      total: asAmount(lineTotal),
    };
  });

  const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    externalOrderId,
    orderNumber: externalOrderId || null,
    orderTotal: asAmount(order.total_amount),
    orderCurrency: order.currency_id ?? "BRL",
    customerEmail: order.buyer?.email ?? null,
    itemsCount,
    items,
    status,
    placedAt: pickValidIsoDate(
      order.date_created,
      order.date_closed,
      order.date_approved,
    ),
    // Fast-path do formato legado; o formato atual exige /shipments/{id}
    // (enriquecido depois em listOrders).
    shippingState: stateLabel(order.shipping?.receiver_address?.state),
  };
}

/**
 * Nome exibível do estado ("Santa Catarina"), com fallback pra sigla derivada
 * do id ISO ("BR-SC" → "SC"). Nome primeiro: os demais conectores gravam nome
 * por extenso e o widget de vendas-por-estado agrupa por string.
 */
function stateLabel(
  state: MercadoLivreStatePayload | undefined,
): string | null {
  if (!state) return null;
  const name = state.name?.trim();
  if (name) return name;
  const id = state.id?.trim();
  if (!id) return null;
  return id.includes("-") ? id.split("-").pop() || null : id;
}

export class MercadoLivreClient {
  private readonly config?: MercadoLivreConfig;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(input: {
    config?: MercadoLivreConfig | null;
    fetchImpl?: FetchLike;
  }) {
    this.config = input.config ?? undefined;
    this.apiBaseUrl =
      input.config?.apiBaseUrl ?? MERCADO_LIVRE_DEFAULT_API_BASE_URL;
    // Fail closed on redirects: a public host the URL guard accepts could still
    // 3xx to an internal/metadata address, exfiltrating the bearer token.
    this.fetchImpl = input.fetchImpl ?? redirectSafeFetch(fetch);
  }

  private requireConfig(): MercadoLivreConfig {
    if (!this.config) {
      throw new Error("Mercado Livre OAuth config is missing");
    }
    return this.config;
  }

  private toToken(response: MercadoLivreTokenResponse): MercadoLivreToken {
    if (!response.access_token) {
      throw new Error("Mercado Livre token response is missing access_token");
    }

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      tokenType: response.token_type ?? "bearer",
      scope: response.scope ?? null,
      userId: String(response.user_id ?? ""),
      expiresIn:
        typeof response.expires_in === "number" ? response.expires_in : 21600,
    };
  }

  async exchangeCodeForAccessToken(code: string): Promise<MercadoLivreToken> {
    const config = this.requireConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    const response = await callWithRetry(() =>
      fetchJson<MercadoLivreTokenResponse>(
        `${this.apiBaseUrl}/oauth/token`,
        this.fetchImpl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
        },
      ),
    );

    return this.toToken(response);
  }

  async refreshAccessToken(refreshToken: string): Promise<MercadoLivreToken> {
    const config = this.requireConfig();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await callWithRetry(() =>
      fetchJson<MercadoLivreTokenResponse>(
        `${this.apiBaseUrl}/oauth/token`,
        this.fetchImpl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
        },
      ),
    );

    return this.toToken(response);
  }

  /** Optional best-effort seller nickname for a friendly account label. */
  async fetchSellerProfile(input: {
    sellerId: string;
    accessToken: string;
  }): Promise<{ nickname: string | null }> {
    try {
      const data = await fetchJson<MercadoLivreUserResponse>(
        `${this.apiBaseUrl}/users/${input.sellerId}`,
        this.fetchImpl,
        {
          headers: { Authorization: `Bearer ${input.accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      );

      return { nickname: data.nickname ?? data.first_name ?? null };
    } catch {
      return { nickname: null };
    }
  }

  private ordersSearchUrl(input: {
    sellerId: string;
    since: string;
    until: string;
    offset: number;
  }) {
    const url = new URL(`${this.apiBaseUrl}/orders/search`);
    url.searchParams.set("seller", input.sellerId);
    url.searchParams.set(
      "order.date_created.from",
      `${input.since.slice(0, 10)}T00:00:00.000-00:00`,
    );
    url.searchParams.set(
      "order.date_created.to",
      `${input.until.slice(0, 10)}T23:59:59.000-00:00`,
    );
    url.searchParams.set("sort", "date_desc");
    url.searchParams.set("limit", String(MERCADO_LIVRE_ORDERS_PAGE_SIZE));
    url.searchParams.set("offset", String(input.offset));

    return url;
  }

  async listOrders(input: {
    sellerId: string;
    accessToken: string;
    since: string;
    until: string;
    /**
     * Absolute epoch-ms wall-clock budget. When provided, pagination stops
     * before this time and returns `complete: false` so a high-volume seller
     * can't overrun the serverless function limit. The caller resumes the
     * remainder from `nextOffset`.
     */
    deadlineMs?: number;
    /** Resume pagination from this item offset (defaults to 0). */
    startOffset?: number;
    /**
     * Per-page persistence callback. When provided, each page's orders are
     * handed to it AS THEY ARE FETCHED and NOT accumulated in memory (returned
     * `orders` stays empty), so a mid-window kill loses at most one page.
     */
    onPage?: (orders: ShopifyOrder[]) => Promise<void>;
  }): Promise<{
    orders: ShopifyOrder[];
    complete: boolean;
    /** Item offset to resume from when `complete` is false. */
    nextOffset: number;
  }> {
    const out: ShopifyOrder[] = [];
    const onPage = input.onPage;
    let offset = Math.max(0, Math.trunc(input.startOffset ?? 0));
    const MAX_PAGES = 1000; // safety cap: 1000 * 50 = 50k orders per window

    for (let i = 0; i < MAX_PAGES; i += 1) {
      if (input.deadlineMs && Date.now() >= input.deadlineMs) {
        return { orders: out, complete: false, nextOffset: offset };
      }

      const url = this.ordersSearchUrl({
        sellerId: input.sellerId,
        since: input.since,
        until: input.until,
        offset,
      });

      const response = await callWithRetry(() =>
        fetchJson<MercadoLivreOrdersResponse>(url, this.fetchImpl, {
          headers: { Authorization: `Bearer ${input.accessToken}` },
          signal: AbortSignal.timeout(15_000),
        }),
      );

      const results = response.results ?? [];
      const pageOrders = results.map(normalizeMercadoLivreOrder);
      // O JSON atual de orders não embute endereço: estado do comprador exige
      // GET /shipments/{shipping.id}. Best-effort (falha → null) e por página,
      // pra planilha de vendas-por-estado do dashboard.
      await this.enrichShippingStates(results, pageOrders, input.accessToken);
      if (onPage) {
        if (pageOrders.length > 0) {
          await onPage(pageOrders);
        }
      } else {
        out.push(...pageOrders);
      }

      // `paging.total` can be absent/zero on a full page; in that case rely on
      // the short-page signal alone so pagination doesn't stop after page 1.
      const total =
        typeof response.paging?.total === "number"
          ? response.paging.total
          : null;
      offset += MERCADO_LIVRE_ORDERS_PAGE_SIZE;
      if (
        results.length < MERCADO_LIVRE_ORDERS_PAGE_SIZE ||
        (total !== null && offset >= total)
      ) {
        return { orders: out, complete: true, nextOffset: offset };
      }

      // Throttle between pages to respect the Mercado Livre rate-limit.
      await sleep(MERCADO_LIVRE_PAGE_THROTTLE_MS);
    }

    // Hit the MAX_PAGES safety cap without exhausting the window.
    return { orders: out, complete: false, nextOffset: offset };
  }

  /**
   * Preenche shippingState dos pedidos da página via GET /shipments/{id}
   * (header x-format-new). Concorrência baixa e best-effort: estado é
   * enriquecimento de dashboard — uma falha nunca derruba o sync de receita.
   */
  private async enrichShippingStates(
    payloads: MercadoLivreOrderPayload[],
    orders: ShopifyOrder[],
    accessToken: string,
  ): Promise<void> {
    const pending: Array<{ index: number; shipmentId: string }> = [];
    for (let index = 0; index < orders.length; index += 1) {
      const shipmentId = payloads[index]?.shipping?.id;
      if (
        !orders[index].shippingState &&
        shipmentId !== undefined &&
        shipmentId !== null
      ) {
        pending.push({ index, shipmentId: String(shipmentId) });
      }
    }
    for (const batch of chunkArray(pending, SHIPMENT_LOOKUP_CONCURRENCY)) {
      await Promise.all(
        batch.map(async ({ index, shipmentId }) => {
          orders[index].shippingState = await this.fetchShipmentState({
            shipmentId,
            accessToken,
          });
        }),
      );
    }
  }

  /** Estado do destinatário de um shipment, ou null (nunca lança). */
  async fetchShipmentState(input: {
    shipmentId: string;
    accessToken: string;
  }): Promise<string | null> {
    try {
      const response = await callWithRetry(() =>
        fetchJson<MercadoLivreShipmentResponse>(
          new URL(`${this.apiBaseUrl}/shipments/${input.shipmentId}`),
          this.fetchImpl,
          {
            headers: {
              Authorization: `Bearer ${input.accessToken}`,
              // Formato novo: endereço em destination.shipping_address.
              "x-format-new": "true",
            },
            signal: AbortSignal.timeout(15_000),
          },
        ),
      );
      return (
        stateLabel(response.destination?.shipping_address?.state) ??
        stateLabel(response.receiver_address?.state)
      );
    } catch {
      return null;
    }
  }

  /**
   * Catálogo do seller → InventoryRow[] (estoque + categoria). IDs via
   * /users/{id}/items/search em modo scan (scroll_id, funciona pra qualquer
   * volume; expira em 5min então o loop consome direto), detalhe via multiget
   * /items?ids= (máx 20, available_quantity REAL só com o token do seller),
   * nome da categoria via /categories/{id} (público, cacheado por execução).
   */
  async listInventory(input: {
    sellerId: string;
    accessToken: string;
  }): Promise<InventoryRow[]> {
    const itemIds: string[] = [];
    let scrollId: string | null = null;
    for (let page = 0; page < ML_INVENTORY_MAX_PAGES; page += 1) {
      const url = new URL(
        `${this.apiBaseUrl}/users/${encodeURIComponent(input.sellerId)}/items/search`,
      );
      url.searchParams.set("search_type", "scan");
      url.searchParams.set("limit", "100");
      if (scrollId) url.searchParams.set("scroll_id", scrollId);

      const response = await callWithRetry(() =>
        fetchJson<MercadoLivreItemsSearchResponse>(url, this.fetchImpl, {
          headers: { Authorization: `Bearer ${input.accessToken}` },
          signal: AbortSignal.timeout(15_000),
        }),
      );
      const ids = (response.results ?? []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      itemIds.push(...ids);
      if (ids.length === 0 || !response.scroll_id) break;
      scrollId = response.scroll_id;
    }

    if (itemIds.length === 0) return [];

    const categoryCache = new Map<string, string | null>();
    const rows: InventoryRow[] = [];
    for (const batch of chunkArray(itemIds, ML_ITEMS_MULTIGET_SIZE)) {
      const url = new URL(`${this.apiBaseUrl}/items`);
      url.searchParams.set("ids", batch.join(","));
      url.searchParams.set(
        "attributes",
        "id,title,available_quantity,category_id,status,seller_custom_field",
      );
      const response = await callWithRetry(() =>
        fetchJson<MercadoLivreItemsMultigetResponse>(url, this.fetchImpl, {
          headers: { Authorization: `Bearer ${input.accessToken}` },
          signal: AbortSignal.timeout(15_000),
        }),
      );
      for (const entry of response ?? []) {
        // Multiget é "verbose": cada elemento tem seu próprio HTTP code
        // (item deletado = 404 no elemento, não na chamada).
        if (entry?.code !== 200 || !entry.body) continue;
        const row = normalizeMercadoLivreInventoryItem(entry.body);
        if (!row) continue;
        row.categoryName = await this.resolveCategoryName(
          entry.body.category_id ?? null,
          categoryCache,
        );
        rows.push(row);
      }
      await sleep(MERCADO_LIVRE_PAGE_THROTTLE_MS);
    }

    return rows;
  }

  /** /categories/{id} é público e estável — cache por execução. */
  private async resolveCategoryName(
    categoryId: string | null,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (!categoryId) return null;
    if (cache.has(categoryId)) return cache.get(categoryId) ?? null;
    let name: string | null = null;
    try {
      const response = await callWithRetry(() =>
        fetchJson<{ name?: string | null }>(
          new URL(`${this.apiBaseUrl}/categories/${categoryId}`),
          this.fetchImpl,
          { signal: AbortSignal.timeout(15_000) },
        ),
      );
      name = response.name?.trim() || null;
    } catch {
      name = null; // categoria é enriquecimento, nunca derruba o inventário
    }
    cache.set(categoryId, name);
    return name;
  }
}

const SHIPMENT_LOOKUP_CONCURRENCY = 4;
const ML_ITEMS_MULTIGET_SIZE = 20;
// 2000 páginas × 100 ids = 200k itens — backstop de runaway, não limite real.
const ML_INVENTORY_MAX_PAGES = 2000;

function chunkArray<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

type MercadoLivreShipmentResponse = {
  destination?: {
    shipping_address?: { state?: MercadoLivreStatePayload } | null;
  } | null;
  // Formato legado (sem x-format-new) — equivalente documentado.
  receiver_address?: { state?: MercadoLivreStatePayload } | null;
};

type MercadoLivreItemsSearchResponse = {
  results?: Array<string | null> | null;
  scroll_id?: string | null;
};

type MercadoLivreItemBodyPayload = {
  id?: string | number | null;
  title?: string | null;
  available_quantity?: number | string | null;
  category_id?: string | null;
  status?: string | null;
  seller_custom_field?: string | null;
};

type MercadoLivreItemsMultigetResponse = Array<{
  code?: number | null;
  body?: MercadoLivreItemBodyPayload | null;
} | null> | null;

/** Item do multiget /items → InventoryRow (puro, testável; categoria à parte). */
export function normalizeMercadoLivreInventoryItem(
  body: MercadoLivreItemBodyPayload | null,
): InventoryRow | null {
  if (!body || body.id === undefined || body.id === null) return null;
  // Anúncio encerrado não é estoque vendável — fora do catálogo.
  if (body.status === "closed") return null;
  const quantity = Number(body.available_quantity);
  return {
    externalProductId: String(body.id),
    sku: body.seller_custom_field?.trim() || null,
    productName: body.title?.trim() || `Item ${body.id}`,
    categoryName: null,
    quantity: Number.isFinite(quantity) ? quantity : null,
  };
}
