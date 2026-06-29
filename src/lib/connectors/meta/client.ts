import { callWithRetry } from "@/lib/connectors/retry";

import type { MetaConfig } from "./oauth";

type FetchLike = typeof fetch;

type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type MetaAdAccountResponse = {
  data?: Array<{
    id: string;
    name?: string;
    account_id?: string;
    currency?: string;
    timezone_name?: string;
  }>;
  paging?: {
    next?: string;
  };
};

type MetaInsightAction = {
  action_type?: string;
  value?: string;
};

type MetaInsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  effective_status?: string;
  configured_status?: string;
  objective?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaInsightAction[];
  action_values?: MetaInsightAction[];
  date_start: string;
  date_stop: string;
};

type MetaInsightsResponse = {
  data?: MetaInsightRow[];
  paging?: {
    next?: string;
  };
};

type MetaCampaignMetadataResponse = {
  id?: string;
  effective_status?: string;
  configured_status?: string;
  objective?: string;
  stop_time?: string;
};

export type MetaAdAccount = {
  id: string;
  name: string;
  accountId: string;
  currency?: string;
  timezoneName?: string;
};

export type MetaCampaignInsight = {
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus?: string | null;
  campaignObjective?: string | null;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  addToCart: string | null;
  conversions: string | null;
  conversionsValue: string | null;
  leads: string | null;
  scheduledEvents: string | null;
  dateStart: string;
  dateStop: string;
};

export type MetaPixelEventIds = {
  leadEventId?: string | null;
  scheduledEventId?: string | null;
};

const purchaseActionTypes = [
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
] as const;

const addToCartActionTypes = [
  "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
  "add_to_cart",
] as const;

/**
 * Splits a YYYY-MM-DD inclusive range into chunks of at most `maxDays` days.
 * Used to avoid Meta /insights HTTP 500 "reduce the amount of data" when the
 * combination of time_increment=1, many campaigns and a wide window blows
 * past the response-size cap.
 */
export function splitDateRangeIntoChunks(
  since: string,
  until: string,
  maxDays: number,
): Array<{ since: string; until: string }> {
  const startMs = Date.parse(`${since}T00:00:00Z`);
  const endMs = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return [{ since, until }];
  }
  const dayMs = 86_400_000;
  const chunks: Array<{ since: string; until: string }> = [];
  let cursor = startMs;
  while (cursor <= endMs) {
    const chunkEnd = Math.min(cursor + (maxDays - 1) * dayMs, endMs);
    chunks.push({
      since: new Date(cursor).toISOString().slice(0, 10),
      until: new Date(chunkEnd).toISOString().slice(0, 10),
    });
    cursor = chunkEnd + dayMs;
  }
  return chunks;
}

function summarizeMetaErrorBody(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        error_user_msg?: string;
        fbtrace_id?: string;
      };
    };
    const err = parsed.error;
    if (!err) return body.slice(0, 220);
    const parts = [
      err.message,
      err.code != null ? `code=${err.code}` : null,
      err.error_subcode != null ? `subcode=${err.error_subcode}` : null,
      err.type ? `type=${err.type}` : null,
    ].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(" | ") : body.slice(0, 220);
  } catch {
    return body.slice(0, 220);
  }
}

export class MetaApiError extends Error {
  status: number;
  body: string;
  response: {
    status: number;
    headers: Headers;
  };

  constructor(status: number, body: string, headers = new Headers()) {
    const summary = summarizeMetaErrorBody(body);
    super(
      summary
        ? `Meta API ${status}: ${summary}`
        : `Meta API request failed with status ${status}`,
    );
    this.name = "MetaApiError";
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
  // Hard per-request timeout — Meta's edge sometimes accepts the request but
  // never returns a response body, leaving the connection hanging beyond any
  // reasonable backoff. AbortSignal.timeout makes us fail fast (and retry
  // upstream) instead of stalling the entire backfill.
  const timeout = AbortSignal.timeout(30_000);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;

  const response = await fetchImpl(url, { ...(init ?? {}), signal });
  const body = await response.text();

  if (!response.ok) {
    throw new MetaApiError(response.status, body, response.headers);
  }

  const retryAfter = parseMetaBusinessUsageRetryAfter(
    response.headers.get("x-business-use-case-usage"),
  );
  if (retryAfter) {
    const headers = new Headers(response.headers);
    headers.set("retry-after", retryAfter);
    throw new MetaApiError(
      429,
      "Meta business usage above the connector threshold",
      headers,
    );
  }

  return JSON.parse(body) as T;
}

export class MetaMarketingClient {
  private readonly config: MetaConfig;
  private readonly fetchImpl: FetchLike;

  constructor(input: { config: MetaConfig; fetchImpl?: FetchLike }) {
    this.config = input.config;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async exchangeCodeForShortLivedToken(code: string) {
    const body = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code,
    });

    return callWithRetry(() =>
      fetchJson<MetaTokenResponse>(
        `https://graph.facebook.com/${this.config.apiVersion}/oauth/access_token`,
        this.fetchImpl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      ),
    );
  }

  async exchangeForLongLivedToken(accessToken: string) {
    const body = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: accessToken,
    });

    return callWithRetry(() =>
      fetchJson<MetaTokenResponse>(
        `https://graph.facebook.com/${this.config.apiVersion}/oauth/access_token`,
        this.fetchImpl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      ),
    );
  }

  async listAdAccounts(accessToken: string) {
    const accounts: MetaAdAccount[] = [];
    let nextUrl: string | undefined;

    const firstUrl = new URL(
      `https://graph.facebook.com/${this.config.apiVersion}/me/adaccounts`,
    );
    firstUrl.searchParams.set(
      "fields",
      "id,name,account_id,currency,timezone_name",
    );
    firstUrl.searchParams.set("limit", "100");
    nextUrl = firstUrl.toString();

    while (nextUrl) {
      const page = await callWithRetry(() =>
        fetchJson<MetaAdAccountResponse>(nextUrl as string, this.fetchImpl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      for (const account of page.data ?? []) {
        accounts.push({
          id: account.id,
          name: account.name ?? account.id,
          accountId: account.account_id ?? account.id.replace(/^act_/, ""),
          currency: account.currency,
          timezoneName: account.timezone_name,
        });
      }

      nextUrl = page.paging?.next;
    }

    return accounts;
  }

  async getCampaignInsights(input: {
    accessToken: string;
    adAccountId: string;
    since: string;
    until: string;
    pixelEventIds?: MetaPixelEventIds;
  }) {
    const insights: MetaCampaignInsight[] = [];
    const accountPath = input.adAccountId.startsWith("act_")
      ? input.adAccountId
      : `act_${input.adAccountId}`;

    // Meta returns HTTP 500 ("Please reduce the amount of data you're asking
    // for, then retry your request | code=1") when /insights payload grows
    // too large. With time_increment=1 + many campaigns + a wide window,
    // even limit=100 can still trip the cap. We split the requested range
    // into <=14-day chunks and paginate within each chunk via `paging.next`.
    // 14 days keeps each chunk's response well below Meta's size cap while
    // still amortizing the per-chunk auth overhead.
    const chunks = splitDateRangeIntoChunks(
      input.since.slice(0, 10),
      input.until.slice(0, 10),
      14,
    );

    // Hard wall-clock budget to avoid HTTP 504 (Vercel function timeout 300s).
    // Stop fetching new chunks past the budget; whatever rows we already
    // gathered are persisted by the sync layer via upsert, so the next sync
    // resumes idempotently with the remaining range.
    const deadline = Date.now() + 240_000;
    let truncated = false;

    const fetchChunk = async (chunk: {
      since: string;
      until: string;
    }): Promise<MetaCampaignInsight[]> => {
      const chunkInsights: MetaCampaignInsight[] = [];
      const firstUrl = new URL(
        `https://graph.facebook.com/${this.config.apiVersion}/${accountPath}/insights`,
      );
      firstUrl.searchParams.set("level", "campaign");
      firstUrl.searchParams.set(
        "fields",
        [
          "campaign_id",
          "campaign_name",
          "spend",
          "impressions",
          "clicks",
          "actions",
          "action_values",
          "date_start",
          "date_stop",
        ].join(","),
      );
      firstUrl.searchParams.set(
        "time_range",
        JSON.stringify({ since: chunk.since, until: chunk.until }),
      );
      firstUrl.searchParams.set(
        "action_attribution_windows",
        JSON.stringify(["7d_click", "1d_view"]),
      );
      firstUrl.searchParams.set("time_increment", "1");
      firstUrl.searchParams.set("limit", "50");

      let nextUrl: string | undefined = firstUrl.toString();
      while (nextUrl) {
        if (Date.now() > deadline) {
          truncated = true;
          return chunkInsights;
        }
        const page = await callWithRetry(
          () =>
            fetchJson<MetaInsightsResponse>(nextUrl as string, this.fetchImpl, {
              headers: {
                Authorization: `Bearer ${input.accessToken}`,
              },
            }),
          // 3 attempts × 30s timeout = max 90s per chunk page; combined with
          // a 14-day chunk + limit=50 keeps each iteration well under the
          // 240s wall-clock budget.
          { maxAttempts: 3 },
        );

        chunkInsights.push(
          ...(page.data ?? []).map((row) =>
            normalizeMetaInsight(row, input.pixelEventIds),
          ),
        );
        nextUrl = page.paging?.next;
      }
      return chunkInsights;
    };

    // Parallelize chunks at concurrency=2 to cut wall-clock roughly in half
    // without doubling Meta API pressure (pagination inside each chunk stays
    // sequential — Meta cursors cannot be parallelized).
    const concurrency = 2;
    for (let i = 0; i < chunks.length; i += concurrency) {
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }
      const batch = chunks.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(fetchChunk));
      for (const rows of batchResults) {
        insights.push(...rows);
      }
      if (truncated) break;
    }

    if (truncated) {
       
      console.warn(
        `[meta/insights] truncated at ${insights.length} rows after 240s — next sync will resume`,
      );
    }

    const enriched = await this.enrichCampaignMetadata({
      accessToken: input.accessToken,
      insights,
    });
    return { insights: enriched, truncated };
  }

  private async enrichCampaignMetadata(input: {
    accessToken: string;
    insights: MetaCampaignInsight[];
  }) {
    const byCampaign = new Map<string, MetaCampaignMetadataResponse>();
    const campaignIds = Array.from(
      new Set(
        input.insights
          .map((insight) => insight.campaignId)
          .filter((campaignId): campaignId is string => Boolean(campaignId)),
      ),
    );

    for (const campaignId of campaignIds) {
      const url = new URL(
        `https://graph.facebook.com/${this.config.apiVersion}/${campaignId}`,
      );
      url.searchParams.set(
        "fields",
        "effective_status,configured_status,objective,stop_time",
      );

      const metadata = await callWithRetry(() =>
        fetchJson<MetaCampaignMetadataResponse>(url, this.fetchImpl, {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
          },
        }),
      );
      byCampaign.set(campaignId, metadata);
    }

    const now = Date.now();
    return input.insights.map((insight) => {
      const metadata = insight.campaignId
        ? byCampaign.get(insight.campaignId)
        : null;

      // Meta keeps `effective_status: ACTIVE` even after a campaign's
      // `stop_time` has elapsed (no automatic flip to PAUSED). Surface
      // that as "ended" so the dashboard does not claim a campaign is
      // still running when it isn't delivering anymore.
      let resolvedStatus =
        metadata?.effective_status ??
        metadata?.configured_status ??
        insight.campaignStatus;
      if (metadata?.stop_time) {
        const stopMs = Date.parse(metadata.stop_time);
        if (Number.isFinite(stopMs) && stopMs < now) {
          resolvedStatus = "ENDED";
        }
      }

      return {
        ...insight,
        campaignStatus: resolvedStatus,
        campaignObjective: metadata?.objective ?? insight.campaignObjective,
      };
    });
  }
}

function findHighUsage(value: unknown): boolean {
  if (typeof value === "number") {
    return value > 75;
  }

  if (Array.isArray(value)) {
    return value.some(findHighUsage);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(([key, nested]) => {
    if (["call_count", "total_cputime", "total_time"].includes(key)) {
      return findHighUsage(nested);
    }

    return findHighUsage(nested);
  });
}

export function parseMetaBusinessUsageRetryAfter(header: string | null) {
  if (!header) {
    return null;
  }

  try {
    return findHighUsage(JSON.parse(header)) ? "3600" : null;
  } catch {
    return null;
  }
}

export function tokenExpiresAt(expiresInSeconds: number | undefined) {
  if (!expiresInSeconds) {
    return null;
  }

  return new Date(Date.now() + expiresInSeconds * 1000);
}

function findPurchaseMetric(actions: MetaInsightAction[] | undefined) {
  for (const actionType of purchaseActionTypes) {
    const value = actions?.find(
      (action) => action.action_type === actionType,
    )?.value;
    if (value) {
      return value;
    }
  }

  return null;
}

function findAddToCartMetric(actions: MetaInsightAction[] | undefined) {
  for (const actionType of addToCartActionTypes) {
    const value = actions?.find(
      (action) => action.action_type === actionType,
    )?.value;
    if (value) {
      return value;
    }
  }

  return null;
}

const LEAD_ACTION_TYPES = [
  "lead",
  "offsite_content_view_add_meta_leads",
  "onsite_conversion.lead_grouped",
] as const;

const OFFSITE_CONVERSION_PREFIX = "offsite_conversion";

function sumActions(
  actions: MetaInsightAction[] | undefined,
  predicate: (type: string) => boolean,
): string | null {
  if (!actions?.length) return null;
  let total = 0;
  let matched = false;
  for (const action of actions) {
    if (!action.action_type || !action.value) continue;
    if (!predicate(action.action_type)) continue;
    const parsed = Number(action.value);
    if (!Number.isFinite(parsed)) continue;
    total += parsed;
    matched = true;
  }
  return matched ? total.toString() : null;
}

function findLeadMetric(
  actions: MetaInsightAction[] | undefined,
  customLeadEventId: string | null | undefined,
): string | null {
  const customMatch = customLeadEventId
    ? actions?.find(
        (action) =>
          action.action_type ===
          `offsite_conversion.custom.${customLeadEventId}`,
      )?.value
    : null;
  if (customMatch) return customMatch;

  for (const actionType of LEAD_ACTION_TYPES) {
    const value = actions?.find(
      (action) => action.action_type === actionType,
    )?.value;
    if (value) return value;
  }
  return null;
}

function findScheduledMetric(
  actions: MetaInsightAction[] | undefined,
  scheduledEventId: string | null | undefined,
): string | null {
  if (!scheduledEventId) return null;
  return (
    actions?.find(
      (action) =>
        action.action_type === `offsite_conversion.custom.${scheduledEventId}`,
    )?.value ?? null
  );
}

function sumOffsiteConversions(
  actions: MetaInsightAction[] | undefined,
): string | null {
  return sumActions(actions, (type) =>
    type.startsWith(OFFSITE_CONVERSION_PREFIX),
  );
}

export function normalizeMetaInsight(
  row: MetaInsightRow,
  pixelEventIds?: MetaPixelEventIds,
): MetaCampaignInsight {
  const purchaseValue = findPurchaseMetric(row.actions);
  const aggregateConversions =
    purchaseValue ?? sumOffsiteConversions(row.actions);

  return {
    campaignId: row.campaign_id ?? null,
    campaignName: row.campaign_name ?? null,
    campaignStatus: row.effective_status ?? row.configured_status ?? null,
    campaignObjective: row.objective ?? null,
    spend: row.spend ?? null,
    impressions: row.impressions ?? null,
    clicks: row.clicks ?? null,
    addToCart: findAddToCartMetric(row.actions),
    conversions: aggregateConversions,
    conversionsValue: findPurchaseMetric(row.action_values),
    leads: findLeadMetric(row.actions, pixelEventIds?.leadEventId),
    scheduledEvents: findScheduledMetric(
      row.actions,
      pixelEventIds?.scheduledEventId,
    ),
    dateStart: row.date_start,
    dateStop: row.date_stop,
  };
}
