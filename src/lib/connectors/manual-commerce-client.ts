import { ConnectorProvider } from "@prisma/client";

import { callWithRetry } from "@/lib/connectors/retry";
import type { ConnectorCredentialPayload } from "@/lib/connectors/credentials";
import {
  assertPublicHttpUrl,
  guardedRedirectFetch,
  redirectSafeFetch,
} from "@/lib/connectors/url-guard";
import {
  normalizeManualInventory,
  type InventoryRow,
} from "@/lib/connectors/inventory";

type FetchLike = typeof fetch;

const WBUY_API_BASE_URL = "https://sistema.sistemawbuy.com.br/api/v1";
const LOJA_INTEGRADA_API_BASE_URL = "https://api.awsli.com.br/v1";
const DEFAULT_USER_AGENT = "W3ADS (integracoes@w3educacao.com.br)";

function credentialString(
  credentials: ConnectorCredentialPayload,
  key: string,
) {
  const value = credentials[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bearerToken(value: string | undefined) {
  return value?.replace(/^(Authorization\s*:?\s*)?Bearer\s+/i, "").trim();
}

function basicBearerToken(
  user: string | undefined,
  password: string | undefined,
) {
  if (!user || !password) {
    return undefined;
  }

  return Buffer.from(`${user}:${password}`).toString("base64");
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function wbuyAuthorizationCandidates(credentials: ConnectorCredentialPayload) {
  const apiKey = credentialString(credentials, "apiKey");
  const apiSecret = credentialString(credentials, "apiSecret");
  const apiUser = credentialString(credentials, "apiUser");
  const apiPassword = credentialString(credentials, "apiPassword");
  const basicToken = basicBearerToken(apiUser, apiPassword);

  return uniqueStrings([
    bearerToken(apiKey) ? `Bearer ${bearerToken(apiKey)}` : undefined,
    bearerToken(apiSecret) ? `Bearer ${bearerToken(apiSecret)}` : undefined,
    basicToken ? `Bearer ${basicToken}` : undefined,
    basicToken ? `Basic ${basicToken}` : undefined,
  ]);
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  // SSRF guard: reject private/loopback/metadata/internal hosts before any fetch.
  const url = assertPublicHttpUrl(trimmed);

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function appendPath(baseUrl: string, path: string) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");

  return `${cleanBase}/${cleanPath}`;
}

/**
 * `fetch()` resolves (does not throw) on HTTP error statuses, so callWithRetry —
 * which only retries on a THROWN error carrying `status`/`response.status` —
 * never sees a 429. Wrapping a retryable response in a thrown error (shaped for
 * retry.ts: `status` + `response.headers` so Retry-After is honored) makes the
 * backoff engage. Used for Loja Integrada, whose 100 req/min per-store cap makes
 * 429s likely on multi-page syncs.
 */
function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryableHttpError(response: Response) {
  const error = new Error(`Retryable HTTP ${response.status}`) as Error & {
    status: number;
    response: { status: number; headers: Headers };
  };
  error.status = response.status;
  error.response = { status: response.status, headers: response.headers };

  return error;
}

function appendIsetBasePath(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/ws\/v1$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/ws/v1`;
}

function providerBaseUrl(
  provider: ConnectorProvider,
  credentials: ConnectorCredentialPayload,
) {
  const configuredBaseUrl = credentialString(credentials, "baseUrl");

  if (provider === ConnectorProvider.GOOGLE_SHEETS) {
    if (!configuredBaseUrl) {
      throw new Error("GOOGLE_SHEETS baseUrl is required");
    }

    // GOOGLE_SHEETS skips normalizeBaseUrl, so guard it explicitly here.
    assertPublicHttpUrl(configuredBaseUrl.trim());
    return configuredBaseUrl.trim();
  }

  if (provider === ConnectorProvider.WBUY) {
    return configuredBaseUrl
      ? normalizeBaseUrl(configuredBaseUrl)
      : WBUY_API_BASE_URL;
  }

  if (provider === ConnectorProvider.LOJA_INTEGRADA) {
    return configuredBaseUrl
      ? normalizeBaseUrl(configuredBaseUrl)
      : LOJA_INTEGRADA_API_BASE_URL;
  }

  if (!configuredBaseUrl) {
    throw new Error(`${provider} baseUrl is required`);
  }

  if (provider === ConnectorProvider.ISET) {
    return appendIsetBasePath(configuredBaseUrl);
  }

  return normalizeBaseUrl(configuredBaseUrl);
}

function providerOrdersPath(
  provider: ConnectorProvider,
  credentials: ConnectorCredentialPayload,
) {
  const configuredPath = credentialString(credentials, "ordersPath");
  if (provider === ConnectorProvider.WBUY && configuredPath) {
    const normalized = configuredPath.replace(/\/+$/, "").toLowerCase();
    if (normalized === "/orders") {
      return "/order";
    }

    return configuredPath;
  }

  if (configuredPath) {
    return configuredPath;
  }

  switch (provider) {
    case ConnectorProvider.WBUY:
      return "/order";
    case ConnectorProvider.ISET:
      return "/pedidos";
    case ConnectorProvider.MAGAZORD:
      // Magazord OpenAPI: GET /api/v2/site/pedido (singular, with /api prefix).
      return "/api/v2/site/pedido";
    case ConnectorProvider.LOJA_INTEGRADA:
      // Loja Integrada (Django Tastypie): GET /pedido/search/ — trailing slash
      // kept so Tastypie doesn't 301-redirect and drop the query string.
      return "/pedido/search/";
    default:
      return "/orders";
  }
}

function buildHeaders(
  provider: ConnectorProvider,
  credentials: ConnectorCredentialPayload,
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": DEFAULT_USER_AGENT,
  };
  const apiKey = credentialString(credentials, "apiKey");
  const apiSecret = credentialString(credentials, "apiSecret");
  const apiUser = credentialString(credentials, "apiUser");
  const apiPassword = credentialString(credentials, "apiPassword");

  if (provider === ConnectorProvider.GOOGLE_SHEETS) {
    return headers;
  }

  if (provider === ConnectorProvider.TRAY) {
    return headers;
  }

  if (provider === ConnectorProvider.WBUY) {
    // WBuy Postman docs (RWTsquyN): collection-level auth is `bearer` with a
    // single token. The panel may show it as `Bearer base64(user:password)`.
    const authorization = wbuyAuthorizationCandidates(credentials)[0];
    if (authorization) {
      headers.Authorization = authorization;
    }
    headers["Content-Type"] = "application/json";

    return headers;
  }

  if (provider === ConnectorProvider.ISET) {
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers["X-Integration-Key"] = apiKey;
    }

    return headers;
  }

  if (provider === ConnectorProvider.MAGAZORD) {
    if (apiUser && apiPassword) {
      headers.Authorization = `Basic ${Buffer.from(
        `${apiUser}:${apiPassword}`,
      ).toString("base64")}`;
    }
    if (apiKey) {
      headers["X-Api-Token"] = apiKey;
    }

    return headers;
  }

  if (provider === ConnectorProvider.LOJA_INTEGRADA) {
    // Loja Integrada auth header is a single custom scheme combining BOTH keys:
    // `Authorization: chave_api <chave_api> aplicacao <chave_aplicacao>`.
    // We map chave_api → apiKey (per-store) and chave_aplicacao → apiSecret
    // (per-integrator). Both are required; missing one yields a 401 upstream.
    if (apiKey && apiSecret) {
      headers.Authorization = `chave_api ${apiKey} aplicacao ${apiSecret}`;
    }
    headers["Content-Type"] = "application/json";

    return headers;
  }

  if (apiUser && apiPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${apiUser}:${apiPassword}`).toString("base64")}`;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  if (apiSecret) {
    headers["X-Api-Secret"] = apiSecret;
  }

  return headers;
}

function appendProviderQueryParams(
  provider: ConnectorProvider,
  url: URL,
  credentials: ConnectorCredentialPayload,
) {
  if (provider === ConnectorProvider.TRAY) {
    const accessToken = credentialString(credentials, "apiKey");
    if (accessToken) {
      url.searchParams.set("access_token", accessToken);
    }
  }
}

function sheetIdFromUrl(value: string) {
  const match = value.match(/\/spreadsheets\/d\/([^/]+)/);
  if (match?.[1]) {
    return match[1];
  }

  return value.trim();
}

function sheetGidFromUrl(value: string, fallback?: string) {
  try {
    const url = new URL(value);
    return url.searchParams.get("gid") ?? fallback ?? "0";
  } catch {
    return fallback ?? "0";
  }
}

function googleSheetsCsvUrl(credentials: ConnectorCredentialPayload) {
  const baseUrl = credentialString(credentials, "baseUrl");
  if (!baseUrl) {
    throw new Error("GOOGLE_SHEETS baseUrl is required");
  }

  const gid = credentialString(credentials, "ordersPath");
  const sheetId = sheetIdFromUrl(baseUrl);
  const sheetGid = sheetGidFromUrl(baseUrl, gid);

  return new URL(
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(
      sheetGid,
    )}`,
  );
}

function parseCsvRows(csv: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseSheetMoney(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) {
    return 0;
  }
  const normalized =
    cleaned.includes(",") && cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : 0;
}

function parseSheetInteger(value: string) {
  const normalized = value.replace(/[^\d-]/g, "");
  const amount = Number(normalized);

  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function parseSheetDateKey(value: string) {
  const trimmed = value.trim();
  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}

function inRange(dateKey: string, range?: { since: string; until: string }) {
  if (!range) {
    return true;
  }

  return (
    dateKey >= range.since.slice(0, 10) && dateKey <= range.until.slice(0, 10)
  );
}

function extractDailyGoogleSheetPayloads(
  rows: string[][],
  range?: { since: string; until: string },
) {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);

    return (
      headers.includes("dia") &&
      headers.includes("qtd_vendas") &&
      headers.includes("valor_em_vendas")
    );
  });

  if (headerIndex < 0) {
    return null;
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const dateIndex = headers.indexOf("dia");
  const quantityIndex = headers.indexOf("qtd_vendas");
  const revenueIndex = headers.indexOf("valor_em_vendas");

  return rows.slice(headerIndex + 1).flatMap((cells) => {
    const dateKey = parseSheetDateKey(cells[dateIndex] ?? "");
    if (!dateKey || !inRange(dateKey, range)) {
      return [];
    }

    const revenue = parseSheetMoney(cells[revenueIndex] ?? "");
    const quantity = parseSheetInteger(cells[quantityIndex] ?? "");
    // Capture any day with revenue, even when "Qtd. Vendas" is blank — those
    // days (e.g. a manual entry with only the total filled) still count toward
    // faturamento. Only skip days with no revenue at all (blank / R$ 0,00).
    if (revenue <= 0) {
      return [];
    }

    return [
      {
        pedido: `GOOGLE_SHEETS-${dateKey}`,
        valor: cells[revenueIndex]?.trim() ?? "",
        status: "APPROVED",
        origem: "whatsapp",
        data: `${dateKey}T00:00:00.000Z`,
        qtd_vendas: String(quantity),
        items_count: String(quantity),
      },
    ];
  });
}

function extractGoogleSheetPayloads(
  csv: string,
  range?: { since: string; until: string },
): Record<string, unknown>[] {
  const rows = parseCsvRows(csv);
  const dailyPayloads = extractDailyGoogleSheetPayloads(rows, range);
  if (dailyPayloads) {
    return dailyPayloads;
  }

  const [headers, ...dataRows] = rows;
  if (!headers?.length) {
    return [];
  }
  const normalizedHeaders = headers.map(normalizeHeader);

  return dataRows
    .map((cells) =>
      Object.fromEntries(
        normalizedHeaders.map((header, index) => [
          header,
          cells[index]?.trim() ?? "",
        ]),
      ),
    )
    .filter((row) =>
      Object.values(row).some((value) => String(value).trim().length > 0),
    );
}

function extractOrderPayloads(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    );
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;

  for (const key of [
    "orders",
    "pedidos",
    "data",
    "items",
    "results",
    // Loja Integrada (Django Tastypie) wraps the list under `objects`.
    "objects",
  ]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      return nested.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      );
    }
    // Magazord-style wrapper: `{ status: "success", data: { items: [...] } }`.
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      for (const inner of ["items", "orders", "pedidos", "results"]) {
        const innerArr = (nested as Record<string, unknown>)[inner];
        if (Array.isArray(innerArr)) {
          return innerArr.filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object"),
          );
        }
      }
    }
  }

  return [];
}

export class ManualCommerceClient {
  private readonly provider: ConnectorProvider;
  private readonly credentials: ConnectorCredentialPayload;
  private readonly fetchImpl: FetchLike;

  constructor(input: {
    provider: ConnectorProvider;
    credentials: ConnectorCredentialPayload;
    fetchImpl?: FetchLike;
  }) {
    this.provider = input.provider;
    this.credentials = input.credentials;
    // Google Sheets' CSV export 307-redirects to googleusercontent.com, so it
    // needs a redirect-following fetch (still SSRF-guarded per hop). Every other
    // provider returns data directly and stays fail-closed on redirects.
    this.fetchImpl =
      input.provider === ConnectorProvider.GOOGLE_SHEETS
        ? guardedRedirectFetch(input.fetchImpl ?? fetch)
        : redirectSafeFetch(input.fetchImpl ?? fetch);
  }

  private ordersUrl(range?: { since: string; until: string }) {
    if (this.provider === ConnectorProvider.GOOGLE_SHEETS) {
      return googleSheetsCsvUrl(this.credentials);
    }

    const url = new URL(
      appendPath(
        providerBaseUrl(this.provider, this.credentials),
        providerOrdersPath(this.provider, this.credentials),
      ),
    );

    if (this.provider === ConnectorProvider.WBUY) {
      // WBuy pagination uses `?limit=<offset>,<size>` (max 100 per page) and
      // does NOT support server-side date filters. Listing flow lives in
      // listOrders() which loops with the WBuy-specific URL builder.
      url.searchParams.set("limit", range ? "0,100" : "0,1");
      return url;
    }

    if (this.provider === ConnectorProvider.MAGAZORD) {
      // Magazord OpenAPI: `dataHora[gte]`/`dataHora[lt]` with YYYY-MM-DD,
      // pagination via `page=<N>&limit=<size>` (max 100). Listing flow lives
      // in listOrders() which loops with the Magazord-specific URL builder.
      if (range) {
        url.searchParams.set("dataHora[gte]", range.since.slice(0, 10));
        url.searchParams.set("dataHora[lt]", range.until.slice(0, 10));
        url.searchParams.set("limit", "100");
        url.searchParams.set("page", "1");
      } else {
        url.searchParams.set("limit", "1");
        url.searchParams.set("page", "1");
      }
      return url;
    }

    if (this.provider === ConnectorProvider.LOJA_INTEGRADA) {
      // Loja Integrada (Tastypie): `?format=json`, date window via
      // `since_criado`/`until_criado` (YYYY-MM-DD), pagination via limit/offset
      // (max 100). The full listing loop lives in listOrders()/
      // fetchLojaIntegradaOrders(); this URL is used for the no-range health
      // check (limit=1) and as the first page when a range is provided.
      url.searchParams.set("format", "json");
      if (range) {
        url.searchParams.set("since_criado", range.since.slice(0, 10));
        url.searchParams.set("until_criado", range.until.slice(0, 10));
        url.searchParams.set("limit", "100");
        url.searchParams.set("offset", "0");
      } else {
        url.searchParams.set("limit", "1");
      }
      return url;
    }

    if (range) {
      // Some providers reject ISO timestamps with timezone — slice to date-only.
      const since = range.since.slice(0, 10);
      const until = range.until.slice(0, 10);
      const sinceParam =
        credentialString(this.credentials, "dateSinceParam") ??
        "created_at_min";
      const untilParam =
        credentialString(this.credentials, "dateUntilParam") ??
        "created_at_max";
      const updatedSinceParam =
        credentialString(this.credentials, "dateUpdatedParam") ??
        "updated_at_min";
      url.searchParams.set(sinceParam, since);
      url.searchParams.set(untilParam, until);
      if (updatedSinceParam && updatedSinceParam !== "none") {
        url.searchParams.set(updatedSinceParam, since);
      }
      url.searchParams.set("limit", "200");
    } else {
      url.searchParams.set("limit", "1");
    }
    appendProviderQueryParams(this.provider, url, this.credentials);

    return url;
  }

  private wbuyOrdersUrls(input: { offset: number; pageSize: number }) {
    const configuredPath = providerOrdersPath(this.provider, this.credentials);
    const cleanPath = configuredPath.replace(/\/+$/, "");
    return uniqueStrings([cleanPath, `${cleanPath}/`]).map((path) => {
      const url = new URL(
        appendPath(providerBaseUrl(this.provider, this.credentials), path),
      );
      url.searchParams.set("limit", `${input.offset},${input.pageSize}`);
      return url;
    });
  }

  private async fetchWbuyResponse(urls: URL[]) {
    const baseHeaders = buildHeaders(this.provider, this.credentials);
    const authCandidates = wbuyAuthorizationCandidates(this.credentials);
    const attempts = authCandidates.length > 0 ? authCandidates : [undefined];
    let lastResponse: Response | null = null;

    for (const url of urls) {
      for (const authorization of attempts) {
        const headers = authorization
          ? { ...baseHeaders, Authorization: authorization }
          : baseHeaders;
        const response = await callWithRetry(() =>
          this.fetchImpl(url, {
            headers,
            // WBuy lists orders via GET /order?limit=offset,size. POST on the
            // same path is treated as *create order* and returns 400
            // ("Existem campos obrigatórios..."), which broke every sync/probe.
            method: "GET",
          }),
        );
        if (response.ok || ![401, 403, 404].includes(response.status)) {
          return response;
        }
        lastResponse = response;
      }
    }

    return lastResponse ?? new Response(null, { status: 401 });
  }

  private async fetchWbuyOrders(range: { since: string; until: string }) {
    const pageSize = 100;
    const MAX_PAGES = 50;
    const sinceKey = range.since.slice(0, 10);
    const untilKey = range.until.slice(0, 10);
    const collected: Record<string, unknown>[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.fetchWbuyResponse(
        this.wbuyOrdersUrls({ offset, pageSize }),
      );

      if (!response.ok) {
        let body = "";
        try {
          body = (await response.text()).slice(0, 300);
        } catch {
          // body unreadable
        }
        const suffix = body ? ` | body: ${body}` : "";
        throw new Error(
          `${this.provider} orders failed with status ${response.status}${suffix}`,
        );
      }

      const payload = extractOrderPayloads(await response.json());
      if (payload.length === 0) {
        break;
      }

      let oldestKey = "";
      for (const order of payload) {
        const created = String(
          (order as Record<string, unknown>).data ??
            (order as Record<string, unknown>).created_at ??
            "",
        ).slice(0, 10);
        if (!created) {
          // Date-less order: SKIP it. Including it unconditionally let an order
          // with no date leak into every sync window and inflate revenue.
          continue;
        }
        if (created >= sinceKey && created <= untilKey) {
          collected.push(order);
        }
        if (!oldestKey || created < oldestKey) {
          oldestKey = created;
        }
      }

      // WBuy returns newest-first by default. Once the oldest record in this
      // page is already before `since`, we can stop paginating.
      if (oldestKey && oldestKey < sinceKey) {
        break;
      }
      if (payload.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return collected;
  }

  private magazordOrdersUrl(input: {
    range: { since: string; until: string };
    page: number;
    pageSize: number;
  }) {
    const url = new URL(
      appendPath(
        providerBaseUrl(this.provider, this.credentials),
        providerOrdersPath(this.provider, this.credentials),
      ),
    );
    url.searchParams.set("dataHora[gte]", input.range.since.slice(0, 10));
    url.searchParams.set("dataHora[lt]", input.range.until.slice(0, 10));
    url.searchParams.set("limit", String(input.pageSize));
    url.searchParams.set("page", String(input.page));
    return url;
  }

  private async fetchMagazordOrders(range: { since: string; until: string }) {
    const pageSize = 100;
    const MAX_PAGES = 50;
    const collected: Record<string, unknown>[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await callWithRetry(() =>
        this.fetchImpl(this.magazordOrdersUrl({ range, page, pageSize }), {
          headers: buildHeaders(this.provider, this.credentials),
        }),
      );

      if (!response.ok) {
        let body = "";
        try {
          body = (await response.text()).slice(0, 300);
        } catch {
          // body unreadable
        }
        const suffix = body ? ` | body: ${body}` : "";
        throw new Error(
          `${this.provider} orders failed with status ${response.status}${suffix}`,
        );
      }

      const payload = extractOrderPayloads(await response.json());
      if (payload.length === 0) {
        break;
      }
      collected.push(...payload);
      if (payload.length < pageSize) {
        break;
      }
    }

    return collected;
  }

  private lojaIntegradaOrdersUrl(input: {
    range: { since: string; until: string };
    offset: number;
    limit: number;
  }) {
    const url = new URL(
      appendPath(
        providerBaseUrl(this.provider, this.credentials),
        providerOrdersPath(this.provider, this.credentials),
      ),
    );
    url.searchParams.set("format", "json");
    // Filter by creation date (since_criado/until_criado) to match the
    // backfill-window semantics the cron + manual route use. LI also offers
    // `since_atualizado` (catches status changes on aged orders), but the
    // generic sync range is creation-window-oriented and the client can't tell
    // backfill from incremental — same trade-off as WBuy/Magazord. Status
    // changes on orders older than the incremental window are not re-fetched.
    url.searchParams.set("since_criado", input.range.since.slice(0, 10));
    url.searchParams.set("until_criado", input.range.until.slice(0, 10));
    url.searchParams.set("limit", String(input.limit));
    url.searchParams.set("offset", String(input.offset));
    return url;
  }

  private async fetchLojaIntegradaOrders(range: {
    since: string;
    until: string;
  }) {
    const pageSize = 100; // Tastypie hard max per page.
    const MAX_PAGES = 100; // 100 * 100 = 10k orders/window safety cap.
    const collected: Record<string, unknown>[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * pageSize;
      const response = await callWithRetry(async () => {
        const res = await this.fetchImpl(
          this.lojaIntegradaOrdersUrl({ range, offset, limit: pageSize }),
          { headers: buildHeaders(this.provider, this.credentials) },
        );
        // Throw on 429/5xx so callWithRetry backs off (honoring Retry-After)
        // instead of failing the whole sync on the first rate-limit hit.
        if (!res.ok && isRetryableHttpStatus(res.status)) {
          throw retryableHttpError(res);
        }
        return res;
      });

      if (!response.ok) {
        let body = "";
        try {
          body = (await response.text()).slice(0, 300);
        } catch {
          // body unreadable
        }
        const suffix = body ? ` | body: ${body}` : "";
        throw new Error(
          `${this.provider} orders failed with status ${response.status}${suffix}`,
        );
      }

      const json = (await response.json()) as unknown;
      const payload = extractOrderPayloads(json);
      if (payload.length === 0) {
        break;
      }
      collected.push(...payload);

      // Stop when Tastypie reports no further page (`meta.next` is null) or the
      // page came back short (defensive: a provider that omits meta won't loop
      // past the data).
      const meta =
        json && typeof json === "object" && !Array.isArray(json)
          ? (json as Record<string, unknown>).meta
          : null;
      const next =
        meta && typeof meta === "object" && !Array.isArray(meta)
          ? (meta as Record<string, unknown>).next
          : null;
      if (!next || payload.length < pageSize) {
        break;
      }
    }

    return collected;
  }

  async healthCheck() {
    if (this.provider === ConnectorProvider.WBUY) {
      const response = await this.fetchWbuyResponse(
        this.wbuyOrdersUrls({ offset: 0, pageSize: 1 }),
      );

      if (!response.ok) {
        throw new Error(
          `${this.provider} credentials failed with status ${response.status}`,
        );
      }

      return { ok: true };
    }

    const response = await callWithRetry(() =>
      this.fetchImpl(this.ordersUrl(), {
        headers: buildHeaders(this.provider, this.credentials),
        method: "GET",
      }),
    );

    if (!response.ok) {
      throw new Error(
        `${this.provider} credentials failed with status ${response.status}`,
      );
    }

    return { ok: true };
  }

  async listOrders(range: { since: string; until: string }) {
    if (this.provider === ConnectorProvider.WBUY) {
      return this.fetchWbuyOrders(range);
    }
    if (this.provider === ConnectorProvider.MAGAZORD) {
      return this.fetchMagazordOrders(range);
    }
    if (this.provider === ConnectorProvider.LOJA_INTEGRADA) {
      return this.fetchLojaIntegradaOrders(range);
    }

    const response = await callWithRetry(() =>
      this.fetchImpl(this.ordersUrl(range), {
        headers: buildHeaders(this.provider, this.credentials),
      }),
    );

    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).slice(0, 300);
      } catch {
        // body unreadable; keep generic message
      }
      const suffix = body ? ` | body: ${body}` : "";
      throw new Error(
        `${this.provider} orders failed with status ${response.status}${suffix}`,
      );
    }

    if (this.provider === ConnectorProvider.GOOGLE_SHEETS) {
      return extractGoogleSheetPayloads(await response.text(), range);
    }

    return extractOrderPayloads(await response.json());
  }

  private lojaIntegradaProductsUrl(input: { offset: number; limit: number }) {
    const url = new URL(
      appendPath(
        providerBaseUrl(this.provider, this.credentials),
        "/produto/search/",
      ),
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(input.limit));
    url.searchParams.set("offset", String(input.offset));
    return url;
  }

  // WBuy lists the catalog at GET /product the same way it lists orders
  // (?limit=<offset>,<size>, max 100). Try both path variants like orders do.
  private wbuyProductsUrls(input: { offset: number; pageSize: number }) {
    return uniqueStrings(["/product", "/product/"]).map((path) => {
      const url = new URL(
        appendPath(providerBaseUrl(this.provider, this.credentials), path),
      );
      url.searchParams.set("limit", `${input.offset},${input.pageSize}`);
      return url;
    });
  }

  // Magazord OpenAPI: GET /api/v2/site/produto, page/limit pagination.
  private magazordProductsUrl(input: { page: number; pageSize: number }) {
    const url = new URL(
      appendPath(
        providerBaseUrl(this.provider, this.credentials),
        "/api/v2/site/produto",
      ),
    );
    url.searchParams.set("limit", String(input.pageSize));
    url.searchParams.set("page", String(input.page));
    return url;
  }

  // Tray Commerce: GET /products?limit=&offset=&access_token=. Items wrap as
  // { Products: [ { Product: {...} } ] }.
  private trayProductsUrl(input: { offset: number; pageSize: number }) {
    const url = new URL(
      appendPath(providerBaseUrl(this.provider, this.credentials), "/products"),
    );
    url.searchParams.set("limit", String(input.pageSize));
    url.searchParams.set("offset", String(input.offset));
    appendProviderQueryParams(this.provider, url, this.credentials);
    return url;
  }

  /**
   * Current per-product stock + category for the store catalog. Dispatches to
   * the provider's product list endpoint and normalizes tolerantly via
   * normalizeManualInventory. Providers without a catalog source return [].
   */
  async listInventory(): Promise<InventoryRow[]> {
    switch (this.provider) {
      case ConnectorProvider.LOJA_INTEGRADA:
        return this.listLojaIntegradaInventory();
      case ConnectorProvider.WBUY:
        return this.listWbuyInventory();
      case ConnectorProvider.MAGAZORD:
        return this.listMagazordInventory();
      case ConnectorProvider.TRAY:
        return this.listTrayInventory();
      default:
        return [];
    }
  }

  private mapInventoryPayloads(payloads: Record<string, unknown>[]) {
    const rows: InventoryRow[] = [];
    for (const payload of payloads) {
      const row = normalizeManualInventory(payload);
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  // Loja Integrada paginates its catalog (/produto/search/) the Tastypie way
  // (offset/limit + meta.next), same as orders.
  private async listLojaIntegradaInventory(): Promise<InventoryRow[]> {
    const pageSize = 100; // Tastypie hard max per page.
    const MAX_PAGES = 200; // 200 * 100 = 20k products safety cap.
    const rows: InventoryRow[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * pageSize;
      const response = await callWithRetry(async () => {
        const res = await this.fetchImpl(
          this.lojaIntegradaProductsUrl({ offset, limit: pageSize }),
          { headers: buildHeaders(this.provider, this.credentials) },
        );
        if (!res.ok && isRetryableHttpStatus(res.status)) {
          throw retryableHttpError(res);
        }
        return res;
      });

      if (!response.ok) {
        throw new Error(
          `${this.provider} products failed with status ${response.status}`,
        );
      }

      const json = (await response.json()) as unknown;
      const payloads = extractOrderPayloads(json);
      if (payloads.length === 0) {
        break;
      }
      rows.push(...this.mapInventoryPayloads(payloads));

      const meta =
        json && typeof json === "object" && !Array.isArray(json)
          ? (json as Record<string, unknown>).meta
          : null;
      const next =
        meta && typeof meta === "object" && !Array.isArray(meta)
          ? (meta as Record<string, unknown>).next
          : null;
      if (!next || payloads.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  private async listWbuyInventory(): Promise<InventoryRow[]> {
    const pageSize = 100;
    const MAX_PAGES = 200; // 200 * 100 = 20k products safety cap.
    const rows: InventoryRow[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.fetchWbuyResponse(
        this.wbuyProductsUrls({ offset, pageSize }),
      );
      if (!response.ok) {
        // Catalog is supplementary — a store that gates /product behind a
        // different scope shouldn't crash; surface the status for the caller's
        // best-effort try/catch.
        throw new Error(
          `${this.provider} products failed with status ${response.status}`,
        );
      }
      const payloads = extractOrderPayloads(await response.json());
      if (payloads.length === 0) {
        break;
      }
      rows.push(...this.mapInventoryPayloads(payloads));
      if (payloads.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return rows;
  }

  private async listMagazordInventory(): Promise<InventoryRow[]> {
    const pageSize = 100;
    const MAX_PAGES = 200;
    const rows: InventoryRow[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await callWithRetry(() =>
        this.fetchImpl(this.magazordProductsUrl({ page, pageSize }), {
          headers: buildHeaders(this.provider, this.credentials),
        }),
      );
      if (!response.ok) {
        throw new Error(
          `${this.provider} products failed with status ${response.status}`,
        );
      }
      const payloads = extractOrderPayloads(await response.json());
      if (payloads.length === 0) {
        break;
      }
      rows.push(...this.mapInventoryPayloads(payloads));
      if (payloads.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  private async listTrayInventory(): Promise<InventoryRow[]> {
    const pageSize = 50;
    const MAX_PAGES = 400; // 400 * 50 = 20k products safety cap.
    const rows: InventoryRow[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await callWithRetry(() =>
        this.fetchImpl(this.trayProductsUrl({ offset, pageSize }), {
          headers: buildHeaders(this.provider, this.credentials),
        }),
      );
      if (!response.ok) {
        throw new Error(
          `${this.provider} products failed with status ${response.status}`,
        );
      }
      // Tray wraps each row as { Product: {...} }; unwrap before normalizing.
      const json = (await response.json()) as unknown;
      const wrapped =
        json && typeof json === "object" && !Array.isArray(json)
          ? (json as Record<string, unknown>).Products
          : null;
      const payloads = (Array.isArray(wrapped) ? wrapped : [])
        .map((item) =>
          item && typeof item === "object" && "Product" in item
            ? (item as Record<string, unknown>).Product
            : item,
        )
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        );
      if (payloads.length === 0) {
        break;
      }
      rows.push(...this.mapInventoryPayloads(payloads));
      if (payloads.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return rows;
  }
}
