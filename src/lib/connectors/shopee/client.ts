import type { InventoryRow } from "@/lib/connectors/inventory";
import type { ListingDetail } from "@/lib/connectors/listing-detail";
import { callWithRetry } from "@/lib/connectors/retry";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";
import { redirectSafeFetch } from "@/lib/connectors/url-guard";

import { type ShopeeConfig } from "./oauth";
import { signPublicRequest, signShopRequest } from "./signer";

type FetchLike = typeof fetch;

/** Shopee `get_order_list` returns up to 100 order_sn per page. */
export const SHOPEE_ORDER_LIST_PAGE_SIZE = 100;
/** `get_order_detail` accepts at most 50 order_sn per call. */
export const SHOPEE_ORDER_DETAIL_BATCH_SIZE = 50;
/** `get_order_list` only accepts a time range of at most 15 days. */
export const SHOPEE_MAX_WINDOW_SECONDS = 15 * 24 * 60 * 60;
/** Per-request delay (ms) to stay within Shopee's request rate-limit. */
const SHOPEE_REQUEST_THROTTLE_MS = 150;
/** Safety cap: 1000 cursor pages per window (1000 * 100 = 100k orders). */
const SHOPEE_MAX_PAGES_PER_WINDOW = 1000;

type ShopeeErrorEnvelope = {
  error?: string;
  message?: string;
};

type ShopeeTokenResponse = ShopeeErrorEnvelope & {
  access_token?: string;
  refresh_token?: string;
  expire_in?: number;
};

export type ShopeeToken = {
  accessToken: string;
  refreshToken: string | null;
  shopId: number;
  /** Access-token lifetime in seconds (~14400 = 4h). */
  expiresIn: number;
};

type ShopeeOrderListResponse = ShopeeErrorEnvelope & {
  response?: {
    order_list?: Array<{ order_sn?: string | null }>;
    more?: boolean;
    next_cursor?: string;
  };
};

type ShopeeOrderItemPayload = {
  item_id?: number | string | null;
  item_name?: string | null;
  item_sku?: string | null;
  model_sku?: string | null;
  model_quantity_purchased?: number | string | null;
  order_item_quantity?: number | string | null;
  model_discounted_price?: number | string | null;
  model_original_price?: number | string | null;
};

type ShopeeOrderPayload = {
  order_sn?: string | null;
  order_status?: string | null;
  total_amount?: number | string | null;
  buyer_total_amount?: number | string | null;
  escrow_amount?: number | string | null;
  currency?: string | null;
  create_time?: number | string | null;
  pay_time?: number | string | null;
  item_list?: ShopeeOrderItemPayload[] | null;
  // Vem apenas quando "recipient_address" está em response_optional_fields.
  // `state` é o estado/província do comprador; `region` é o PAÍS ("BR").
  recipient_address?: {
    state?: string | null;
    city?: string | null;
    region?: string | null;
  } | null;
};

type ShopeeOrderDetailResponse = ShopeeErrorEnvelope & {
  response?: {
    order_list?: ShopeeOrderPayload[];
  };
};

/**
 * Shopee fulfillment states that imply a confirmed, paid sale. Shopee has no
 * standalone "paid" status: payment confirmation is folded into the fulfillment
 * lifecycle, so an order in any of these is already paid.
 */
const SHOPEE_PAID_STATUSES = new Set<string>([
  "READY_TO_SHIP",
  "PROCESSED",
  "RETRY_SHIP",
  "SHIPPED",
  "TO_CONFIRM_RECEIVE",
  "COMPLETED",
]);

export const SHOPEE_ORDER_DETAIL_OPTIONAL_FIELDS =
  "total_amount,buyer_total_amount,escrow_amount,create_time,pay_time,order_status,item_list,currency,recipient_address";

export class ShopeeApiError extends Error {
  status: number;
  body: string;
  response: {
    status: number;
    headers: Headers;
  };

  constructor(status: number, body: string, headers = new Headers()) {
    super(`Shopee API request failed with status ${status}`);
    this.name = "ShopeeApiError";
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
    throw new ShopeeApiError(response.status, body, response.headers);
  }

  return JSON.parse(body) as T;
}

/**
 * Shopee returns HTTP 200 even for logical failures, with a non-empty `error`
 * field in the JSON body. Surface those as a thrown Error so they don't pass as
 * empty success payloads (and so an expired token marks the connector ERROR).
 */
function assertNoShopeeError(body: ShopeeErrorEnvelope) {
  if (typeof body.error === "string" && body.error.length > 0) {
    throw new Error(
      `Shopee API error: ${body.error}${body.message ? ` - ${body.message}` : ""}`,
    );
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asAmount(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/**
 * First valid UNIX-seconds candidate, as an ISO string. Returns "" when none
 * parse, so the downstream parsePlacedAt guard SKIPS the order instead of
 * dating it to now() (which would inflate today's metrics).
 */
function isoFromUnixSeconds(
  ...candidates: Array<number | string | null | undefined>
): string {
  for (const candidate of candidates) {
    const seconds = num(candidate);
    if (seconds > 0) {
      const date = new Date(seconds * 1000);
      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  return "";
}

/**
 * Shopee order → canonical ShopifyOrder.
 *
 * Status normalization happens HERE (not at the metric layer). Shopee's "paid"
 * states are fulfillment states (READY_TO_SHIP, PROCESSED, SHIPPED, ...), which
 * the generic isApprovedOrderStatus REJECTS (a fulfillment state alone does not
 * prove payment for most connectors). To make the shared filter count Shopee
 * correctly, we emit "paid" for any status in SHOPEE_PAID_STATUSES, "cancelled"
 * for CANCELLED/IN_CANCEL, "refunded" for TO_RETURN (return/refund), and pass
 * anything else through (UNPAID/INVOICE_PENDING already match REJECTED terms).
 * Same approach as the Mercado Livre connector.
 *
 * Total = buyer_total_amount (includes shipping the buyer paid) → total_amount →
 * escrow_amount; final fallback sums item_list (model_discounted_price * qty).
 */
export function normalizeShopeeOrder(order: ShopeeOrderPayload): ShopifyOrder {
  const externalOrderId = String(order.order_sn ?? "");
  const rawStatus = (order.order_status ?? "").toUpperCase();

  let status: string;
  if (SHOPEE_PAID_STATUSES.has(rawStatus)) {
    status = "paid";
  } else if (rawStatus === "CANCELLED" || rawStatus === "IN_CANCEL") {
    status = "cancelled";
  } else if (rawStatus === "TO_RETURN") {
    status = "refunded";
  } else {
    status = rawStatus || "unknown";
  }

  const items = (order.item_list ?? []).map((item, index) => {
    const quantity =
      num(item.model_quantity_purchased) || num(item.order_item_quantity) || 1;
    const price =
      num(item.model_discounted_price) || num(item.model_original_price);
    const itemId = item.item_id;
    return {
      productName: item.item_name ?? `Produto ${index + 1}`,
      sku:
        item.model_sku ||
        item.item_sku ||
        (itemId === undefined || itemId === null ? null : String(itemId)),
      quantity,
      total: asAmount(price * quantity),
    };
  });

  let orderTotal =
    num(order.buyer_total_amount) ||
    num(order.total_amount) ||
    num(order.escrow_amount);
  if (orderTotal === 0) {
    orderTotal = items.reduce((sum, item) => sum + num(item.total), 0);
  }

  const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    externalOrderId,
    orderNumber: externalOrderId || null,
    orderTotal: asAmount(orderTotal),
    orderCurrency: order.currency ?? "BRL",
    customerEmail: null,
    itemsCount,
    items,
    status,
    placedAt: isoFromUnixSeconds(order.create_time, order.pay_time),
    shippingState: order.recipient_address?.state?.trim() || null,
  };
}

/** Splits [from, to] (unix seconds) into ranges of at most 15 days. */
function buildWindows(from: number, to: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(start + SHOPEE_MAX_WINDOW_SECONDS, to);
    windows.push([start, end]);
    if (end >= to) break;
    start = end + 1;
  }
  return windows;
}

function toUnixSeconds(isoDate: string, endOfDay: boolean): number {
  const suffix = endOfDay ? "T23:59:59.000Z" : "T00:00:00.000Z";
  return Math.floor(Date.parse(`${isoDate.slice(0, 10)}${suffix}`) / 1000);
}

export class ShopeeClient {
  private readonly config?: ShopeeConfig;
  private readonly fetchImpl: FetchLike;

  constructor(input: { config?: ShopeeConfig | null; fetchImpl?: FetchLike }) {
    this.config = input.config ?? undefined;
    // Fail closed on redirects: a public host the URL guard accepts could still
    // 3xx to an internal/metadata address, exfiltrating the access token.
    this.fetchImpl = input.fetchImpl ?? redirectSafeFetch(fetch);
  }

  private requireConfig(): ShopeeConfig {
    if (!this.config) {
      throw new Error("Shopee OAuth config is missing");
    }
    return this.config;
  }

  private toToken(response: ShopeeTokenResponse, shopId: number): ShopeeToken {
    assertNoShopeeError(response);
    if (!response.access_token) {
      throw new Error("Shopee token response is missing access_token");
    }
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      shopId,
      expiresIn:
        typeof response.expire_in === "number" ? response.expire_in : 14400,
    };
  }

  /** POST to a public (non-shop) endpoint with the public signature scheme. */
  private async publicPost<T extends ShopeeErrorEnvelope>(
    apiPath: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const config = this.requireConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signPublicRequest({
      partnerId: config.partnerId,
      partnerKey: config.partnerKey,
      apiPath,
      timestamp,
    });
    const url = new URL(`${config.host}${apiPath}`);
    url.searchParams.set("partner_id", String(config.partnerId));
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);

    const result = await callWithRetry(() =>
      fetchJson<T>(url, this.fetchImpl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      }),
    );
    assertNoShopeeError(result);
    return result;
  }

  /** GET a shop-scoped endpoint with the shop signature scheme. */
  private async shopGet<T extends ShopeeErrorEnvelope>(input: {
    apiPath: string;
    params: Record<string, string | number>;
    accessToken: string;
    shopId: number;
  }): Promise<T> {
    const config = this.requireConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShopRequest({
      partnerId: config.partnerId,
      partnerKey: config.partnerKey,
      apiPath: input.apiPath,
      timestamp,
      accessToken: input.accessToken,
      shopId: input.shopId,
    });
    const url = new URL(`${config.host}${input.apiPath}`);
    url.searchParams.set("partner_id", String(config.partnerId));
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    url.searchParams.set("access_token", input.accessToken);
    url.searchParams.set("shop_id", String(input.shopId));
    for (const [key, value] of Object.entries(input.params)) {
      url.searchParams.set(key, String(value));
    }

    const result = await callWithRetry(() =>
      fetchJson<T>(url, this.fetchImpl, {
        signal: AbortSignal.timeout(15_000),
      }),
    );
    assertNoShopeeError(result);
    return result;
  }

  async exchangeCodeForAccessToken(input: {
    code: string;
    shopId: number;
  }): Promise<ShopeeToken> {
    const config = this.requireConfig();
    const response = await this.publicPost<ShopeeTokenResponse>(
      "/api/v2/auth/token/get",
      {
        code: input.code,
        shop_id: input.shopId,
        partner_id: config.partnerId,
      },
    );
    return this.toToken(response, input.shopId);
  }

  async refreshAccessToken(input: {
    refreshToken: string;
    shopId: number;
  }): Promise<ShopeeToken> {
    const config = this.requireConfig();
    const response = await this.publicPost<ShopeeTokenResponse>(
      "/api/v2/auth/access_token/get",
      {
        refresh_token: input.refreshToken,
        shop_id: input.shopId,
        partner_id: config.partnerId,
      },
    );
    return this.toToken(response, input.shopId);
  }

  /** Collects every order_sn in a 15-day window via cursor pagination. */
  private async collectOrderSns(input: {
    shopId: number;
    accessToken: string;
    timeFrom: number;
    timeTo: number;
    deadlineMs?: number;
  }): Promise<{ orderSns: string[]; complete: boolean }> {
    const orderSns: string[] = [];
    let cursor = "";
    let more = true;

    for (let page = 0; page < SHOPEE_MAX_PAGES_PER_WINDOW && more; page += 1) {
      if (input.deadlineMs && Date.now() >= input.deadlineMs) {
        return { orderSns, complete: false };
      }

      const params: Record<string, string | number> = {
        time_range_field: "create_time",
        time_from: input.timeFrom,
        time_to: input.timeTo,
        page_size: SHOPEE_ORDER_LIST_PAGE_SIZE,
      };
      if (cursor) {
        params.cursor = cursor;
      }

      const response = await this.shopGet<ShopeeOrderListResponse>({
        apiPath: "/api/v2/order/get_order_list",
        params,
        accessToken: input.accessToken,
        shopId: input.shopId,
      });

      for (const item of response.response?.order_list ?? []) {
        if (item.order_sn) {
          orderSns.push(item.order_sn);
        }
      }
      more = Boolean(response.response?.more);
      cursor = response.response?.next_cursor ?? "";
      // Shopee anomaly: more=true with an empty next_cursor cannot advance —
      // stop instead of refetching page 0 until the safety cap.
      if (more && !cursor) {
        more = false;
      }

      await sleep(SHOPEE_REQUEST_THROTTLE_MS);
    }

    // If the loop exited on the page cap with `more` still true, the window is
    // incomplete — report it so the caller reprocesses rather than skipping.
    return { orderSns, complete: !more };
  }

  /**
   * Lists orders for [since, until], deadline-bounded and resumable BY WINDOW.
   *
   * Shopee caps each `get_order_list` time range at 15 days, so the window is
   * split into 15-day sub-windows; pagination within a sub-window is cursor
   * based (opaque, not seekable). The resumable unit is therefore the 15-day
   * sub-window index: `startWindowIndex` skips fully-completed sub-windows and
   * `nextWindowIndex` reports where to resume. A sub-window's index only
   * advances after it completes, so a mid-window deadline/kill re-fetches that
   * sub-window (idempotent upserts), never skipping data.
   *
   * `onPage` receives each detail batch as it is fetched (so it can be persisted
   * incrementally); `onWindowComplete` fires after each sub-window so the caller
   * can checkpoint the resume offset.
   */
  async listOrders(input: {
    shopId: number;
    accessToken: string;
    since: string;
    until: string;
    deadlineMs?: number;
    startWindowIndex?: number;
    onPage?: (orders: ShopifyOrder[]) => Promise<void>;
    onWindowComplete?: (nextWindowIndex: number) => Promise<void>;
  }): Promise<{
    orders: ShopifyOrder[];
    complete: boolean;
    nextWindowIndex: number;
  }> {
    const out: ShopifyOrder[] = [];
    const onPage = input.onPage;
    const timeFrom = toUnixSeconds(input.since, false);
    const timeTo = toUnixSeconds(input.until, true);
    const windows = buildWindows(timeFrom, timeTo);
    const start = Math.max(0, Math.trunc(input.startWindowIndex ?? 0));

    for (let i = start; i < windows.length; i += 1) {
      if (input.deadlineMs && Date.now() >= input.deadlineMs) {
        return { orders: out, complete: false, nextWindowIndex: i };
      }

      const [winStart, winEnd] = windows[i];
      const { orderSns, complete: snComplete } = await this.collectOrderSns({
        shopId: input.shopId,
        accessToken: input.accessToken,
        timeFrom: winStart,
        timeTo: winEnd,
        deadlineMs: input.deadlineMs,
      });

      if (!snComplete) {
        // Deadline hit mid-window: resume this same window next run.
        return { orders: out, complete: false, nextWindowIndex: i };
      }

      for (const batch of chunks(orderSns, SHOPEE_ORDER_DETAIL_BATCH_SIZE)) {
        if (input.deadlineMs && Date.now() >= input.deadlineMs) {
          return { orders: out, complete: false, nextWindowIndex: i };
        }

        const response = await this.shopGet<ShopeeOrderDetailResponse>({
          apiPath: "/api/v2/order/get_order_detail",
          params: {
            order_sn_list: batch.join(","),
            response_optional_fields: SHOPEE_ORDER_DETAIL_OPTIONAL_FIELDS,
          },
          accessToken: input.accessToken,
          shopId: input.shopId,
        });

        const pageOrders = (response.response?.order_list ?? []).map(
          normalizeShopeeOrder,
        );
        if (onPage) {
          if (pageOrders.length > 0) {
            await onPage(pageOrders);
          }
        } else {
          out.push(...pageOrders);
        }

        await sleep(SHOPEE_REQUEST_THROTTLE_MS);
      }

      if (input.onWindowComplete) {
        await input.onWindowComplete(i + 1);
      }
    }

    return { orders: out, complete: true, nextWindowIndex: windows.length };
  }

  /**
   * Catálogo completo da loja → InventoryRow[] (estoque + categoria pro
   * dashboard). get_item_list pagina os ids (has_next_page/next_offset),
   * get_item_base_info detalha em lotes de 50 (o array de ids casa com o
   * page_size), e get_category (1 chamada, árvore inteira) resolve o nome.
   */
  /** Todos os item ids ativos da loja (get_item_list paginado por offset). */
  async listShopItemIds(input: {
    shopId: number;
    accessToken: string;
  }): Promise<number[]> {
    const itemIds: number[] = [];
    let offset = 0;
    for (let page = 0; page < SHOPEE_MAX_PAGES_PER_WINDOW; page += 1) {
      const response = await this.shopGet<ShopeeItemListResponse>({
        apiPath: "/api/v2/product/get_item_list",
        params: {
          offset,
          page_size: SHOPEE_ITEM_BATCH_SIZE,
          item_status: "NORMAL",
        },
        accessToken: input.accessToken,
        shopId: input.shopId,
      });
      // ATENÇÃO de shape: o array chama-se `item` (não item_list).
      for (const item of response.response?.item ?? []) {
        if (item?.item_id !== undefined && item.item_id !== null) {
          itemIds.push(Number(item.item_id));
        }
      }
      if (!response.response?.has_next_page) break;
      const next = Number(response.response?.next_offset);
      if (!Number.isFinite(next) || next <= offset) break; // anti-loop
      offset = next;
      await sleep(SHOPEE_REQUEST_THROTTLE_MS);
    }
    return itemIds;
  }

  async listInventory(input: {
    shopId: number;
    accessToken: string;
  }): Promise<InventoryRow[]> {
    const itemIds = await this.listShopItemIds(input);
    if (itemIds.length === 0) return [];

    const categoryNames = await this.fetchCategoryNames(input);

    const rows: InventoryRow[] = [];
    for (const batch of chunks(itemIds, SHOPEE_ITEM_BATCH_SIZE)) {
      const response = await this.shopGet<ShopeeItemBaseInfoResponse>({
        apiPath: "/api/v2/product/get_item_base_info",
        params: { item_id_list: batch.join(",") },
        accessToken: input.accessToken,
        shopId: input.shopId,
      });
      for (const item of response.response?.item_list ?? []) {
        const row = normalizeShopeeInventoryItem(item, categoryNames);
        if (row) rows.push(row);
      }
      await sleep(SHOPEE_REQUEST_THROTTLE_MS);
    }

    return rows;
  }

  /**
   * Detalhe completo dos anúncios (imagens + ficha técnica + descrição) para
   * importar/otimizar. get_item_base_info já traz image/description/attributes
   * — só tipamos os campos extras. Lotes de 50; nome da categoria resolvido pela
   * árvore (get_category), 1 chamada.
   */
  async fetchListingDetails(input: {
    shopId: number;
    accessToken: string;
    itemIds: number[];
  }): Promise<ListingDetail[]> {
    if (input.itemIds.length === 0) return [];
    const out: ListingDetail[] = [];
    for (const batch of chunks(input.itemIds, SHOPEE_ITEM_BATCH_SIZE)) {
      const response = await this.shopGet<ShopeeItemDetailResponse>({
        apiPath: "/api/v2/product/get_item_base_info",
        params: {
          item_id_list: batch.join(","),
          need_complaint_policy: "false",
          need_tax_info: "false",
        },
        accessToken: input.accessToken,
        shopId: input.shopId,
      });
      for (const item of response.response?.item_list ?? []) {
        if (!item?.item_id) continue;
        out.push(normalizeShopeeListing(item));
      }
      await sleep(SHOPEE_REQUEST_THROTTLE_MS);
    }
    return out;
  }

  /** Árvore inteira de categorias em 1 chamada → mapa id → nome exibível. */
  private async fetchCategoryNames(input: {
    shopId: number;
    accessToken: string;
  }): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    try {
      const response = await this.shopGet<ShopeeCategoryResponse>({
        apiPath: "/api/v2/product/get_category",
        params: {},
        accessToken: input.accessToken,
        shopId: input.shopId,
      });
      for (const category of response.response?.category_list ?? []) {
        const id = Number(category?.category_id);
        const name =
          category?.display_category_name?.trim() ||
          category?.original_category_name?.trim();
        if (Number.isFinite(id) && name) names.set(id, name);
      }
    } catch (error: unknown) {
      // Categoria é enriquecimento: sem ela o estoque ainda vale.
      const message = error instanceof Error ? error.message : "unknown";
      console.warn(`[shopee] get_category falhou: ${message}`);
    }
    return names;
  }
}

const SHOPEE_ITEM_BATCH_SIZE = 50;

type ShopeeItemListResponse = ShopeeErrorEnvelope & {
  response?: {
    item?: Array<{ item_id?: number | string | null } | null> | null;
    has_next_page?: boolean | null;
    next_offset?: number | string | null;
  };
};

type ShopeeItemBaseInfoPayload = {
  item_id?: number | string | null;
  item_name?: string | null;
  item_sku?: string | null;
  category_id?: number | string | null;
  item_status?: string | null;
  stock_info_v2?: {
    summary_info?: {
      total_available_stock?: number | string | null;
    } | null;
  } | null;
};

type ShopeeItemBaseInfoResponse = ShopeeErrorEnvelope & {
  response?: {
    item_list?: Array<ShopeeItemBaseInfoPayload | null> | null;
  };
};

type ShopeeCategoryResponse = ShopeeErrorEnvelope & {
  response?: {
    category_list?: Array<{
      category_id?: number | string | null;
      original_category_name?: string | null;
      display_category_name?: string | null;
    } | null> | null;
  };
};

type ShopeeItemDetailPayload = ShopeeItemBaseInfoPayload & {
  description?: string | null;
  image?: { image_url_list?: Array<string | null> | null } | null;
  price_info?: Array<{
    current_price?: number | string | null;
    original_price?: number | string | null;
  } | null> | null;
  attribute_list?: Array<{
    original_attribute_name?: string | null;
    attribute_name?: string | null;
    attribute_value_list?: Array<{
      original_value_name?: string | null;
      value_name?: string | null;
    } | null> | null;
  } | null> | null;
};

type ShopeeItemDetailResponse = ShopeeErrorEnvelope & {
  response?: { item_list?: Array<ShopeeItemDetailPayload | null> | null };
};

/** Item Shopee (get_item_base_info expandido) → ListingDetail canônico. */
export function normalizeShopeeListing(
  item: ShopeeItemDetailPayload,
): ListingDetail {
  const images = (item.image?.image_url_list ?? [])
    .map((url) => url?.trim() || null)
    .filter((url): url is string => Boolean(url));
  const attributes: Record<string, string> = {};
  for (const attr of item.attribute_list ?? []) {
    const name =
      attr?.original_attribute_name?.trim() || attr?.attribute_name?.trim();
    const value =
      attr?.attribute_value_list?.[0]?.value_name?.trim() ||
      attr?.attribute_value_list?.[0]?.original_value_name?.trim();
    if (name && value) attributes[name] = value;
  }
  const price = Number(
    item.price_info?.[0]?.current_price ?? item.price_info?.[0]?.original_price,
  );
  const stock = Number(item.stock_info_v2?.summary_info?.total_available_stock);
  const categoryId = Number(item.category_id);
  return {
    externalId: String(item.item_id),
    title: item.item_name?.trim() || null,
    description: item.description?.trim() || null,
    categoryId: Number.isFinite(categoryId) ? String(categoryId) : null,
    price: Number.isFinite(price) ? price : null,
    availableQuantity: Number.isFinite(stock) ? stock : null,
    images,
    attributes,
  };
}

/** Item do get_item_base_info → InventoryRow (puro, testável). */
export function normalizeShopeeInventoryItem(
  item: ShopeeItemBaseInfoPayload | null,
  categoryNames: Map<number, string>,
): InventoryRow | null {
  if (!item || item.item_id === undefined || item.item_id === null) {
    return null;
  }
  const stock = Number(item.stock_info_v2?.summary_info?.total_available_stock);
  const categoryId = Number(item.category_id);
  return {
    externalProductId: String(item.item_id),
    sku: item.item_sku?.trim() || null,
    productName: item.item_name?.trim() || `Item ${item.item_id}`,
    categoryName: Number.isFinite(categoryId)
      ? (categoryNames.get(categoryId) ?? null)
      : null,
    quantity: Number.isFinite(stock) ? stock : null,
  };
}
