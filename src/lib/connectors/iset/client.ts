import { callWithRetry } from "@/lib/connectors/retry";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";
import {
  assertPublicHttpUrl,
  redirectSafeFetch,
} from "@/lib/connectors/url-guard";

type FetchLike = typeof fetch;

export type IsetConfig = {
  /** Store domain or full URL. Normalized to `https://{domain}/ws/v1`. */
  baseUrl: string;
  /** API user identifier (the `identifier` half of Basic auth). */
  identifier: string;
  /** API access key (the `secret` half of Basic auth). */
  secret: string;
};

type IsetOAuthResponse = {
  status?: number;
  token?: string;
  expires_in?: number;
};

export type IsetOrder = {
  orderId?: number;
  orderTotal?: number;
  orderTotalPaid?: number;
  statusId?: number;
  orderIsComplete?: boolean;
  datePurchased?: string;
  lastModified?: string;
  datePaid?: string | null;
  currency?: string;
};

type IsetOrderListResponse = {
  status?: number;
  offset?: string;
  ordersFound?: number;
  ordersTotal?: number;
  orders?: IsetOrder[];
};

const DEFAULT_USER_AGENT = "W3Ads-Connector/1.0";
const PAGE_SIZE = 50;
const MAX_PAGES = 200; // safety cap: 200 * 50 = 10k orders per sync window
// iSET refuses to issue a new token while a previous one is still active
// (tokens live 15 min and are renewed on every request). We therefore reuse a
// single token across IsetClient instances within the same runtime via a
// module-level cache, only re-authenticating when it is gone/expired.
const TOKEN_REUSE_MS = 13 * 60 * 1000;
const tokenCache = new Map<string, { token: string; at: number }>();
// When /oauth reports an active token we can't recover, back off before trying
// again so background syncs don't keep the token alive forever (each attempt
// would otherwise reset iSET's 15-min inactivity timer).
const AUTH_BACKOFF_MS = 15 * 60 * 1000;
const authBackoff = new Map<string, number>();

export class IsetApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`iSET API ${status}: ${body.slice(0, 220)}`);
    this.name = "IsetApiError";
    this.status = status;
    this.body = body;
  }
}

function isActiveTokenConflict(body: string): boolean {
  return /already been created|já.*criad/i.test(body);
}

/** Normalizes "www.loja.com.br" or "https://loja.com.br/" → "https://loja.com.br/ws/v1". */
function normalizeIsetBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("ISET baseUrl is required");
  }
  // SSRF guard: reject private/loopback/metadata/internal hosts before any fetch.
  const url = assertPublicHttpUrl(trimmed);
  const host = `${url.protocol}//${url.host}`;
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/ws\/v1$/i.test(path)) {
    return `${host}${path}`;
  }
  return `${host}/ws/v1`;
}

/** iSET returns datePurchased as "YYYY-MM-DD HH:MM:SS" (store local time). */
function isetDateToIso(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Make it ISO-ish so Date.parse is deterministic across runtimes.
  return trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
}

/**
 * True when an iSET order has a CONFIRMED payment.
 *
 * iSET base order states (store-customizable names, but these are the stock
 * semantics): "Pendente" = placed, payment NOT started; "Processando" =
 * payment received, confirming; "Liberado" = confirmed/ready to ship;
 * "Cancelado" = cancelled. Only "Processando"/"Liberado" represent an
 * approved sale.
 *
 * The order object exposes two payment signals that hold regardless of the
 * store's custom status labels: `datePaid` (timestamp stamped when payment is
 * confirmed) and `orderTotalPaid` (amount actually received). We approve only
 * when one of them is present, so unpaid "Pendente" orders never reach the
 * revenue total. `orderIsComplete` is intentionally NOT used as an approval
 * signal — it flags that the order record is finalized (which can include
 * unpaid or cancelled orders), not that money was received.
 */
function isIsetOrderPaid(order: IsetOrder): boolean {
  // `||` is intentional: iSET stamps `orderTotalPaid` only once a payment is
  // CONFIRMED (it stays 0 for "Pendente" and for gateway pre-auth that never
  // settled), and `datePaid` may lag the amount on some gateways. Either signal
  // alone proves money was received. The persisted sale value remains
  // `orderTotal` (see normalizeIsetOrder) — for a fully-paid order
  // orderTotal === orderTotalPaid, so this does not over/under-count the
  // common case; partial settlements are rare on iSET and out of scope here.
  const hasPaymentDate = Boolean(order.datePaid && order.datePaid.trim());
  const hasPaidAmount =
    typeof order.orderTotalPaid === "number" && order.orderTotalPaid > 0;
  return hasPaymentDate || hasPaidAmount;
}

/**
 * Maps an iSET order to the shared normalized shape. Status is derived so the
 * downstream `isApprovedOrderStatus` filter only counts PAID orders toward
 * revenue — see {@link isIsetOrderPaid} for why unpaid/complete orders are
 * excluded.
 */
export function normalizeIsetOrder(order: IsetOrder): ShopifyOrder {
  const status = isIsetOrderPaid(order) ? "paid" : "pending";

  return {
    externalOrderId: String(order.orderId ?? ""),
    orderNumber: order.orderId != null ? `#${order.orderId}` : null,
    orderTotal: String(order.orderTotal ?? 0),
    orderCurrency: order.currency ?? "BRL",
    customerEmail: null,
    itemsCount: 1,
    status,
    placedAt: isetDateToIso(order.datePurchased),
  };
}

export class IsetClient {
  private readonly baseUrl: string;
  private readonly identifier: string;
  private readonly secret: string;
  private readonly fetchImpl: FetchLike;
  private token: string | null = null;

  private readonly cacheKey: string;

  private readonly onToken?: (token: string) => void | Promise<void>;

  constructor(input: {
    config: IsetConfig;
    fetchImpl?: FetchLike;
    /** Reuse a previously-issued token (e.g. persisted on the connector). */
    initialToken?: string | null;
    /**
     * Called the instant a fresh token is minted, BEFORE any orders are
     * fetched. The caller must persist it synchronously-durably (e.g. to the
     * connector row) so that if this serverless function is later killed
     * mid-fetch, the next invocation reuses the same token instead of calling
     * /oauth again — which iSET rejects with "sessão já ativa" (403), orphaning
     * the session until it expires by inactivity.
     */
    onToken?: (token: string) => void | Promise<void>;
  }) {
    this.baseUrl = normalizeIsetBaseUrl(input.config.baseUrl);
    this.identifier = input.config.identifier?.trim() ?? "";
    this.secret = input.config.secret?.trim() ?? "";
    this.fetchImpl = redirectSafeFetch(input.fetchImpl ?? fetch);
    this.cacheKey = `${this.identifier}@${this.baseUrl}`;
    this.token = input.initialToken?.trim() || null;
    this.onToken = input.onToken;

    if (!this.identifier || !this.secret) {
      throw new Error("ISET identifier and secret are required");
    }
  }

  /** Current access token, if one has been obtained/reused. */
  get activeToken(): string | null {
    return this.token;
  }

  /** POST /oauth with Basic auth → access token (valid 15 min). */
  private async authenticate(): Promise<string> {
    const basic = Buffer.from(`${this.identifier}:${this.secret}`).toString(
      "base64",
    );
    const response = await callWithRetry(
      () =>
        this.fetchImpl(`${this.baseUrl}/oauth`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
          },
          signal: AbortSignal.timeout(20_000),
        }),
      { maxAttempts: 3 },
    );
    const body = await response.text();
    if (!response.ok || isActiveTokenConflict(body)) {
      // iSET still has a live token we don't hold. We cannot mint a new one
      // until it expires by inactivity (~15 min). Back off so repeated syncs
      // don't keep resetting that timer, and surface a clear message.
      if (isActiveTokenConflict(body)) {
        authBackoff.set(this.cacheKey, Date.now());
        throw new IsetApiError(
          response.status || 403,
          "iSET já tem uma sessão ativa. Aguarde ~15 minutos sem sincronizar e tente novamente (a sessão anterior expira por inatividade).",
        );
      }
      throw new IsetApiError(response.status, body);
    }
    const parsed = JSON.parse(body) as IsetOAuthResponse;
    if (!parsed.token) {
      throw new IsetApiError(
        parsed.status ?? response.status,
        body || "iSET oauth returned no token",
      );
    }
    authBackoff.delete(this.cacheKey);
    // Persist the token NOW, before fetching any orders, so a mid-fetch kill
    // doesn't orphan this freshly-minted iSET session. Only adopt/cache it
    // AFTER persistence succeeds — if the DB write throws we must NOT proceed
    // with a token we couldn't durably store, or a later kill re-orphans it.
    await this.onToken?.(parsed.token);
    this.token = parsed.token;
    tokenCache.set(this.cacheKey, { token: parsed.token, at: Date.now() });
    return parsed.token;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }
    const cached = tokenCache.get(this.cacheKey);
    if (cached && Date.now() - cached.at < TOKEN_REUSE_MS) {
      this.token = cached.token;
      return cached.token;
    }
    // Respect the active-token backoff: don't keep hammering /oauth (which
    // would reset iSET's inactivity timer and never let the old token die).
    const backoffAt = authBackoff.get(this.cacheKey);
    if (backoffAt && Date.now() - backoffAt < AUTH_BACKOFF_MS) {
      throw new IsetApiError(
        403,
        "iSET já tem uma sessão ativa. Aguarde ~15 minutos sem sincronizar e tente novamente.",
      );
    }
    return this.authenticate();
  }

  /** Forget the current token so the next call re-authenticates. */
  private invalidateToken() {
    this.token = null;
    tokenCache.delete(this.cacheKey);
  }

  /** Lightweight connection check: a successful token exchange proves creds. */
  async healthCheck(): Promise<void> {
    await this.ensureToken();
  }

  private async fetchOrderPage(input: {
    since: string;
    until: string;
    offset: string;
    retryOnAuth?: boolean;
  }): Promise<IsetOrderListResponse> {
    const token = await this.ensureToken();
    const response = await this.fetchImpl(`${this.baseUrl}/order/list`, {
      method: "POST",
      headers: {
        "access-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      body: JSON.stringify({
        date: {
          from: input.since.slice(0, 10),
          to: input.until.slice(0, 10),
        },
        order: "orders_id",
        order_type: "asc",
        offset: input.offset,
      }),
      // 15s/page (was 30s) so a slow page fails fast and the wall-clock budget
      // in listOrders can stop cleanly before the 300s function limit.
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();

    // Token expired/invalid — iSET returns 401 or 403 "Access token is missing
    // or invalid." Re-auth once and retry.
    if (
      (response.status === 401 || response.status === 403) &&
      input.retryOnAuth !== false
    ) {
      this.invalidateToken();
      return this.fetchOrderPage({ ...input, retryOnAuth: false });
    }
    if (!response.ok) {
      throw new IsetApiError(response.status, body);
    }
    return JSON.parse(body) as IsetOrderListResponse;
  }

  /**
   * Lists orders in the [since, until] window, paginating until exhausted.
   *
   * When `deadlineMs` (an absolute epoch-ms wall-clock budget) is provided,
   * pagination stops before that time and returns whatever was fetched so far
   * (`complete: false`). This keeps a single iSET sync inside the serverless
   * function limit (Hobby: 300s) — a window with thousands of rate-limited
   * pages would otherwise overrun and the gateway returns 504. The caller must
   * NOT advance its backfill cursor for an incomplete window so the remainder
   * is re-fetched on the next sync.
   */
  async listOrders(input: {
    since: string;
    until: string;
    deadlineMs?: number;
    /** Resume pagination from this iSET row offset (0 = from the start). */
    startOffset?: number;
    /**
     * Per-page persistence callback. When provided, each page's normalized
     * orders are handed to it AS THEY ARE FETCHED and are NOT accumulated in
     * memory (the returned `orders` stays empty), so a mid-window function kill
     * loses at most one page — the rest is already durable and the caller can
     * resume from `nextOffset`.
     */
    onPage?: (orders: ShopifyOrder[]) => Promise<void>;
  }): Promise<{
    orders: ShopifyOrder[];
    complete: boolean;
    /** Row offset to resume from when `complete` is false. */
    nextOffset: number;
  }> {
    const out: ShopifyOrder[] = [];
    const onPage = input.onPage;
    let cursor = Math.max(0, Math.trunc(input.startOffset ?? 0));

    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (input.deadlineMs && Date.now() >= input.deadlineMs) {
        return { orders: out, complete: false, nextOffset: cursor };
      }
      // iSET offset format: "offset,limit".
      const offset = `${cursor},${PAGE_SIZE}`;
      const data = await callWithRetry(
        () =>
          this.fetchOrderPage({
            since: input.since,
            until: input.until,
            offset,
          }),
        { maxAttempts: 3 },
      );
      const pageOrders = (data.orders ?? []).map(normalizeIsetOrder);
      if (onPage) {
        if (pageOrders.length > 0) {
          await onPage(pageOrders);
        }
      } else {
        for (const order of pageOrders) {
          out.push(order);
        }
      }
      cursor += pageOrders.length;
      if (pageOrders.length < PAGE_SIZE) {
        return { orders: out, complete: true, nextOffset: cursor };
      }
    }

    // Hit the MAX_PAGES safety cap without exhausting the window.
    return { orders: out, complete: false, nextOffset: cursor };
  }
}
