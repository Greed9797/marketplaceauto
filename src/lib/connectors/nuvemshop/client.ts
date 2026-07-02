import { callWithRetry } from "@/lib/connectors/retry";
import { resolveCategory, type InventoryRow } from "@/lib/connectors/inventory";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";

import type { NuvemshopConfig } from "./oauth";

type FetchLike = typeof fetch;

type NuvemshopTokenResponse = {
  access_token: string;
  token_type?: string;
  scope?: string;
  user_id: string | number;
};

type NuvemshopOrderPayload = {
  id?: string | number;
  number?: string | number;
  contact_email?: string | null;
  email?: string | null;
  total?: string | number;
  total_paid?: string | number;
  currency?: string;
  status?: string;
  payment_status?: string;
  created_at?: string;
  completed_at?: string | null;
  paid_at?: string | null;
  products?: Array<{
    name?: string | null;
    product_name?: string | null;
    sku?: string | null;
    quantity?: string | number;
    price?: string | number | null;
    total?: string | number | null;
  }>;
  shipping_address?: {
    province?: string | null;
    province_code?: string | null;
    state?: string | null;
  } | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
};

export type NuvemshopToken = {
  accessToken: string;
  tokenType: string;
  scope: string | null;
  storeId: string;
};

function summarizeNuvemshopErrorBody(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      code?: string;
      description?: string;
      message?: string;
      error?: string;
      error_description?: string;
    };
    const parts = [
      parsed.code,
      parsed.description ?? parsed.message ?? parsed.error_description,
      parsed.error,
    ].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(" | ") : body.slice(0, 220);
  } catch {
    return body.slice(0, 220);
  }
}

export class NuvemshopApiError extends Error {
  status: number;
  body: string;
  response: {
    status: number;
    headers: Headers;
  };

  constructor(status: number, body: string, headers = new Headers()) {
    const summary = summarizeNuvemshopErrorBody(body);
    super(
      summary
        ? `Nuvemshop API ${status}: ${summary}`
        : `Nuvemshop API request failed with status ${status}`,
    );
    this.name = "NuvemshopApiError";
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
    throw new NuvemshopApiError(response.status, body, response.headers);
  }

  return JSON.parse(body) as T;
}

async function fetchJsonWithHeaders<T>(
  url: URL | string,
  fetchImpl: FetchLike,
  init?: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  const response = await fetchImpl(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new NuvemshopApiError(response.status, body, response.headers);
  }

  return {
    data: JSON.parse(body) as T,
    headers: response.headers,
  };
}

function asString(value: string | number | undefined | null) {
  return value === undefined || value === null ? null : String(value);
}

/**
 * Returns the first input that parses as a real Date, in ISO string form.
 * Nuvemshop sometimes returns empty strings or malformed timestamps for
 * `paid_at`/`completed_at` on voided/refunded orders; `??` only filters
 * null/undefined, so we explicitly probe with Date.parse to avoid feeding
 * `Invalid Date` into Prisma.
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
  // No valid date: return "" so the downstream parsePlacedAt guard SKIPS the
  // order. Falling back to now() silently attributed date-less orders to today,
  // inflating the current day's revenue with phantom rows.
  return "";
}

function normalizeNuvemshopOrder(order: NuvemshopOrderPayload): ShopifyOrder {
  const externalOrderId = asString(order.id);
  if (!externalOrderId) {
    throw new Error("Nuvemshop order is missing id");
  }

  // Creation timestamp for revenue bucketing (NuvemShop reports revenue by
  // created_at). pickValidIsoDate returns "" when absent/invalid → store null.
  const orderCreatedAtIso = pickValidIsoDate(order.created_at);

  return {
    externalOrderId,
    orderNumber: asString(order.number),
    orderTotal: asString(order.total_paid ?? order.total) ?? "0",
    orderCurrency: order.currency ?? "BRL",
    customerEmail: order.contact_email ?? order.email ?? null,
    itemsCount:
      order.products?.reduce((sum, item) => {
        const quantity = Number(item.quantity ?? 1);

        return sum + (Number.isFinite(quantity) ? quantity : 1);
      }, 0) ?? 0,
    items:
      order.products?.map((item, index) => {
        const quantity = Number(item.quantity ?? 1);

        return {
          productName: item.name ?? item.product_name ?? `Produto ${index + 1}`,
          sku: item.sku ?? null,
          quantity: Number.isFinite(quantity) ? quantity : 1,
          total: asString(item.total ?? item.price),
        };
      }) ?? [],
    status: order.payment_status ?? order.status ?? "UNKNOWN",
    shippingState:
      order.shipping_address?.province_code ??
      order.shipping_address?.state ??
      order.shipping_address?.province ??
      null,
    placedAt: pickValidIsoDate(
      order.paid_at,
      order.completed_at,
      order.created_at,
    ),
    orderCreatedAt: orderCreatedAtIso || null,
    utmSource: order.utm_source ?? null,
    utmMedium: order.utm_medium ?? null,
    utmCampaign: order.utm_campaign ?? null,
  };
}

type NuvemshopI18n = string | Record<string, string> | null | undefined;

type NuvemshopCategory = {
  id?: string | number;
  name?: NuvemshopI18n;
  parent?: string | number | null;
  subcategories?: Array<string | number> | null;
};

type NuvemshopProductPayload = {
  id?: string | number;
  name?: NuvemshopI18n;
  categories?: Array<NuvemshopCategory> | null;
  variants?: Array<{
    sku?: string | null;
    stock?: number | string | null;
    // false = the store does not manage stock for this variant (unlimited).
    stock_management?: boolean | null;
  }> | null;
};

/**
 * Pick the most specific category for a product. Nuvemshop returns every
 * category a product belongs to (often a broad parent like "Nicho" PLUS a
 * leaf subcategory). Taking the first one buried the useful label, so we prefer
 * a leaf (no in-set subcategory) that has a parent — the deepest, most
 * descriptive bucket — and fall back to any leaf, then the first category.
 */
function pickNuvemshopCategory(
  categories: Array<NuvemshopCategory>,
): string | null {
  if (categories.length === 0) {
    return null;
  }
  const idSet = new Set(categories.map((category) => String(category.id)));
  const isLeaf = (category: NuvemshopCategory): boolean =>
    !(category.subcategories ?? []).some((childId) =>
      idSet.has(String(childId)),
    );
  const leaves = categories.filter(isLeaf);
  const specific = leaves.filter(
    (category) => category.parent !== null && category.parent !== undefined,
  );
  const chosen = specific[0] ?? leaves[0] ?? categories[0];
  return resolveCategory(chosen.name);
}

/** First non-empty value of an i18n map (pt first), or the raw string. */
function nuvemshopI18n(value: NuvemshopI18n): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (value && typeof value === "object") {
    for (const key of ["pt", "pt_BR", "es", "en"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    const first = Object.values(value).find(
      (item) => typeof item === "string" && item.trim(),
    );
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

/** Nuvemshop product → InventoryRow. Stock summed across variants. */
function normalizeNuvemshopProduct(
  product: NuvemshopProductPayload,
): InventoryRow | null {
  const externalProductId =
    product.id === undefined || product.id === null ? null : String(product.id);
  const productName = nuvemshopI18n(product.name);
  if (!externalProductId || !productName) {
    return null;
  }

  const variants = product.variants ?? [];
  // Stock model: a variant with stock_management === false is unlimited
  // (the store sells it without tracking a count). Only sum variants that ARE
  // tracked. If NONE are tracked, the product is "available/unlimited" →
  // quantity null (rendered "Disponível"), never a misleading 0.
  let trackedSum = 0;
  let hasTracked = false;
  for (const variant of variants) {
    if (variant.stock_management === false) {
      continue;
    }
    hasTracked = true;
    const raw = Number(variant.stock);
    trackedSum += Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  }
  const quantity = hasTracked ? trackedSum : null;
  const sku =
    variants.map((variant) => variant.sku).find((value) => Boolean(value)) ??
    null;
  const categoryName = pickNuvemshopCategory(product.categories ?? []);

  return {
    externalProductId,
    sku: sku ? String(sku).trim() : null,
    productName,
    categoryName,
    quantity,
  };
}

export class NuvemshopClient {
  private readonly config: NuvemshopConfig;
  private readonly fetchImpl: FetchLike;

  constructor(input: { config: NuvemshopConfig; fetchImpl?: FetchLike }) {
    this.config = input.config;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async exchangeCodeForAccessToken(code: string): Promise<NuvemshopToken> {
    const body = JSON.stringify({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "authorization_code",
      code,
    });
    const response = await callWithRetry(() =>
      fetchJson<NuvemshopTokenResponse>(
        "https://www.nuvemshop.com.br/apps/authorize/token",
        this.fetchImpl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      ),
    );

    return {
      accessToken: response.access_token,
      tokenType: response.token_type ?? "bearer",
      scope: response.scope ?? null,
      storeId: String(response.user_id),
    };
  }

  private ordersUrl(input: {
    storeId: string;
    since: string;
    until: string;
    page: number;
    // "created_at" (default) for historical backfill; "updated_at" for the
    // incremental recurring sync so late-paid / refunded transitions surface.
    dateField?: "created_at" | "updated_at";
    // true (default) filters payment_status=paid at the source; false pulls all
    // payment statuses (status=any) so pending→paid and paid→refunded are seen
    // and the paid/non-cancelled decision moves to the aggregation layer.
    paidOnly?: boolean;
  }) {
    const dateField = input.dateField ?? "created_at";
    const paidOnly = input.paidOnly ?? true;
    const url = new URL(`${this.config.apiBaseUrl}/${input.storeId}/orders`);
    // `since`/`until` may arrive as a full ISO instant (e.g.
    // "2026-06-01T00:00:00.000Z") from the sync range or as a plain
    // "YYYY-MM-DD". Slice the date portion before re-appending the day bounds
    // so we never emit a double-suffixed string like "...000ZT00:00:00Z",
    // which Nuvemshop rejects with HTTP 422 Unprocessable Entity.
    url.searchParams.set(
      `${dateField}_min`,
      `${input.since.slice(0, 10)}T00:00:00Z`,
    );
    url.searchParams.set(
      `${dateField}_max`,
      `${input.until.slice(0, 10)}T23:59:59Z`,
    );
    // Fulfillment-agnostic (open/closed). payment_status is set only in paidOnly
    // mode; incremental sync pulls every payment status (status=any) and lets the
    // metric rollup (isApprovedOrderStatus) decide revenue one layer later.
    url.searchParams.set("status", "any");
    if (paidOnly) {
      url.searchParams.set("payment_status", "paid");
    }
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", "200");

    return url;
  }

  async listOrders(input: {
    storeId: string;
    accessToken: string;
    since: string;
    until: string;
    /**
     * Absolute epoch-ms wall-clock budget. When provided, pagination stops
     * before this time and returns `complete: false` so a high-volume store
     * can't overrun the serverless function limit (Hobby: 300s) and be killed
     * mid-flight (orphaned job, 0 orders persisted). The caller resumes the
     * remainder from `nextPage`.
     */
    deadlineMs?: number;
    /** Resume pagination from this 1-based page (defaults to page 1). */
    startPage?: number;
    /** Filter by "created_at" (default, backfill) or "updated_at" (incremental). */
    dateField?: "created_at" | "updated_at";
    /** true (default) = payment_status=paid; false = all payment statuses. */
    paidOnly?: boolean;
    /**
     * Per-page persistence callback. When provided, each page's orders are
     * handed to it AS THEY ARE FETCHED and NOT accumulated in memory (returned
     * `orders` stays empty), so a mid-window kill loses at most one page.
     */
    onPage?: (orders: ShopifyOrder[]) => Promise<void>;
  }): Promise<{
    orders: ShopifyOrder[];
    complete: boolean;
    /** 1-based page to resume from when `complete` is false. */
    nextPage: number;
  }> {
    const out: ShopifyOrder[] = [];
    const onPage = input.onPage;
    // Page explicitly (ignore the Link rel=next header) so resume-by-page is
    // deterministic across runs; past windows are stable so the same page
    // returns the same rows.
    let page = Math.max(1, Math.trunc(input.startPage ?? 1));
    const firstPage = page;
    const MAX_PAGES = 1000; // safety cap: 1000 * 200 = 200k orders per window

    for (let i = 0; i < MAX_PAGES; i += 1) {
      if (input.deadlineMs && Date.now() >= input.deadlineMs) {
        return { orders: out, complete: false, nextPage: page };
      }
      const url = this.ordersUrl({
        storeId: input.storeId,
        since: input.since,
        until: input.until,
        page,
        dateField: input.dateField,
        paidOnly: input.paidOnly,
      });
      let response: { data: NuvemshopOrderPayload[]; headers: Headers };
      try {
        response = await callWithRetry(() =>
          fetchJsonWithHeaders<NuvemshopOrderPayload[]>(url, this.fetchImpl, {
            headers: {
              Authentication: `bearer ${input.accessToken}`,
              "User-Agent": "W3ADS (integracoes@w3educacao.com.br)",
            },
            // Fail a slow page fast so the wall-clock budget can stop cleanly
            // before the function limit (matches the iSET per-page timeout).
            signal: AbortSignal.timeout(15_000),
          }),
        );
      } catch (error: unknown) {
        // Nuvemshop returns 404 ("Last page is N") when a page past the last is
        // requested — happens when the previous page was exactly full (200), so
        // the `< 200` check below never fires. Treat it as end-of-pagination,
        // but only after the first page; a 404 on the first page is a real
        // error (bad store/endpoint) and must surface.
        if (
          error instanceof NuvemshopApiError &&
          error.status === 404 &&
          page > firstPage
        ) {
          return { orders: out, complete: true, nextPage: page };
        }
        throw error;
      }

      const pageOrders = response.data.map(normalizeNuvemshopOrder);
      if (onPage) {
        if (pageOrders.length > 0) {
          await onPage(pageOrders);
        }
      } else {
        out.push(...pageOrders);
      }

      page += 1;
      if (response.data.length < 200) {
        return { orders: out, complete: true, nextPage: page };
      }
    }

    // Hit the MAX_PAGES safety cap without exhausting the window.
    return { orders: out, complete: false, nextPage: page };
  }

  /**
   * Current catalog (stock + category per product) for the store. Paginates
   * GET /{storeId}/products; only `id,name,categories,variants` are requested
   * to keep the payload small. Returns normalized InventoryRows for the
   * inventory sync to upsert.
   */
  async listProducts(input: {
    storeId: string;
    accessToken: string;
  }): Promise<InventoryRow[]> {
    const rows: InventoryRow[] = [];
    const perPage = 200;
    const MAX_PAGES = 1000; // safety cap: 1000 * 200 = 200k products.

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(
        `${this.config.apiBaseUrl}/${input.storeId}/products`,
      );
      url.searchParams.set("fields", "id,name,categories,variants");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(perPage));

      let response: NuvemshopProductPayload[];
      try {
        response = await callWithRetry(() =>
          fetchJson<NuvemshopProductPayload[]>(url, this.fetchImpl, {
            headers: {
              Authentication: `bearer ${input.accessToken}`,
              "User-Agent": "W3ADS (integracoes@w3educacao.com.br)",
            },
            signal: AbortSignal.timeout(15_000),
          }),
        );
      } catch (error: unknown) {
        // 404 past the last page (previous page was exactly full) → stop, not
        // an error. A 404 on page 1 is a real failure and must surface.
        if (
          error instanceof NuvemshopApiError &&
          error.status === 404 &&
          page > 1
        ) {
          break;
        }
        throw error;
      }

      for (const product of response) {
        const row = normalizeNuvemshopProduct(product);
        if (row) {
          rows.push(row);
        }
      }

      if (response.length < perPage) {
        break;
      }
    }

    return rows;
  }
}
