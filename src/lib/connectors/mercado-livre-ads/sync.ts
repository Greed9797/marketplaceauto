import { ConnectorProvider, type ConnectorAccount } from "@prisma/client";

import { connectorAccessTokenFromAccount } from "@/lib/connectors/credentials";
import {
  adsDailyMetricDedupeHash,
  asAdsDateOnly,
  isEmptyAdsRecord,
  parseAdsIsoDate,
  toAdsBigInt,
  toAdsDecimalString,
  toAdsNumber,
  type AdsDailyMetricRecord,
  type MarketplaceAdsSyncRange,
} from "@/lib/connectors/marketplace-ads-metric";
import { MERCADO_LIVRE_DEFAULT_API_BASE_URL } from "@/lib/connectors/mercado-livre/oauth";
import { callWithRetry } from "@/lib/connectors/retry";
import { prisma } from "@/lib/db/prisma";

type FetchLike = typeof fetch;

/** Product Ads (`PADS`) campaign report caps each query window at 30 days. */
const MERCADO_LIVRE_ADS_MAX_WINDOW_DAYS = 30;

/** Per-request delay (ms) to stay within Mercado Livre's rate-limit. */
const MERCADO_LIVRE_ADS_REQUEST_THROTTLE_MS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

type MercadoLivreAdvertisersResponse = {
  advertisers?: Array<{ advertiser_id?: string | number | null }> | null;
  results?: Array<{ advertiser_id?: string | number | null }> | null;
};

/**
 * One daily row from `product_ads/campaigns` with `aggregation_type=DAILY`.
 * Spend is `cost`, impressions are `prints`. When the report breaks down by
 * campaign, `campaign_id`/`campaign_name` (or `id`/`name`) are populated.
 */
export type MercadoLivreAdsDailyRow = {
  date?: string | null;
  cost?: number | string | null;
  prints?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  campaign_id?: string | number | null;
  id?: string | number | null;
  campaign_name?: string | null;
  name?: string | null;
};

type MercadoLivreAdsCampaignsResponse = {
  results?: MercadoLivreAdsDailyRow[] | null;
};

function asOptionalString(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/**
 * Pure normalizer: a Mercado Livre Product Ads daily row → a `DailyMetric`
 * upsert payload, or `null` when the date is missing/invalid. Spend
 * (`cost`)/impressions (`prints`)/clicks only — `revenue` and `orders` are
 * pinned to `null`. Campaign id/name are carried through when present so the
 * dedupeHash separates per-campaign rows.
 */
export function normalizeMercadoLivreAdsRow(input: {
  workspaceId: string;
  connectorAccountId: string;
  row: MercadoLivreAdsDailyRow;
}): AdsDailyMetricRecord | null {
  const dateKey = parseAdsIsoDate(input.row.date);
  if (!dateKey) return null;

  const campaignId =
    asOptionalString(input.row.campaign_id) ?? asOptionalString(input.row.id);
  const campaignName = input.row.campaign_name ?? input.row.name ?? null;
  const spend = toAdsNumber(input.row.cost);
  const impressions =
    toAdsNumber(input.row.prints) || toAdsNumber(input.row.impressions);
  const clicks = toAdsNumber(input.row.clicks);

  return {
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    date: asAdsDateOnly(dateKey),
    source: ConnectorProvider.MERCADO_LIVRE_ADS,
    campaignId,
    campaignName,
    spend: toAdsDecimalString(spend),
    impressions: toAdsBigInt(impressions),
    clicks: toAdsBigInt(clicks),
    revenue: null,
    orders: null,
    dedupeHash: adsDailyMetricDedupeHash({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      date: dateKey,
      source: ConnectorProvider.MERCADO_LIVRE_ADS,
      campaignId,
    }),
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Splits [since, until] (YYYY-MM-DD) into <= 30-day sub-windows. */
function buildDayWindows(
  since: string,
  until: string,
): Array<{ from: string; to: string }> {
  const windows: Array<{ from: string; to: string }> = [];
  const endMs = asAdsDateOnly(until).getTime();
  let startMs = asAdsDateOnly(since).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return windows;
  }

  while (startMs <= endMs) {
    const windowEndMs = Math.min(
      startMs + (MERCADO_LIVRE_ADS_MAX_WINDOW_DAYS - 1) * DAY_MS,
      endMs,
    );
    windows.push({
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(windowEndMs).toISOString().slice(0, 10),
    });
    startMs = windowEndMs + DAY_MS;
  }

  return windows;
}

async function fetchAdvertiserIds(input: {
  apiBaseUrl: string;
  accessToken: string;
  fetchImpl: FetchLike;
}): Promise<string[]> {
  const url = new URL(`${input.apiBaseUrl}/advertising/advertisers`);
  url.searchParams.set("product_id", "PADS");

  const response = await callWithRetry(async () => {
    const res = await input.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "Api-Version": "1",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `Mercado Livre advertisers API ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    if (!body.trim())
      return { advertisers: [] } as MercadoLivreAdvertisersResponse;
    return JSON.parse(body) as MercadoLivreAdvertisersResponse;
  });

  const advertisers = response.advertisers ?? response.results ?? [];
  return advertisers
    .map((advertiser) => asOptionalString(advertiser?.advertiser_id))
    .filter((id): id is string => Boolean(id));
}

async function fetchCampaignDailyRows(input: {
  apiBaseUrl: string;
  accessToken: string;
  advertiserId: string;
  dateFrom: string;
  dateTo: string;
  fetchImpl: FetchLike;
}): Promise<MercadoLivreAdsDailyRow[]> {
  const url = new URL(
    `${input.apiBaseUrl}/advertising/advertisers/${input.advertiserId}/product_ads/campaigns`,
  );
  url.searchParams.set("date_from", input.dateFrom);
  url.searchParams.set("date_to", input.dateTo);
  url.searchParams.set("metrics", "clicks,prints,cost");
  url.searchParams.set("aggregation_type", "DAILY");
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");

  const response = await callWithRetry(async () => {
    const res = await input.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "api-version": "2",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `Mercado Livre Product Ads API ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    if (!body.trim())
      return { results: [] } as MercadoLivreAdsCampaignsResponse;
    return JSON.parse(body) as MercadoLivreAdsCampaignsResponse;
  });

  return response.results ?? [];
}

/**
 * Syncs Mercado Livre Product Ads daily spend into `DailyMetric`
 * (source=MERCADO_LIVRE_ADS) for the parent MERCADO_LIVRE connector. Reuses the
 * parent account's (refresh-aware) Bearer token. Idempotent: rows are upserted
 * by dedupeHash. When a row carries no spend/impressions/clicks it is skipped.
 */
export async function syncMercadoLivreAdsDailyMetrics(input: {
  account: ConnectorAccount;
  range: MarketplaceAdsSyncRange;
  fetchImpl?: FetchLike;
}): Promise<{ rowsUpserted: number }> {
  const { account } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const accessToken = await connectorAccessTokenFromAccount(account);
  const apiBaseUrl = MERCADO_LIVRE_DEFAULT_API_BASE_URL;

  const advertiserIds = await fetchAdvertiserIds({
    apiBaseUrl,
    accessToken,
    fetchImpl,
  });
  if (advertiserIds.length === 0) {
    return { rowsUpserted: 0 };
  }

  const windows = buildDayWindows(input.range.since, input.range.until);
  let rowsUpserted = 0;

  for (const window of windows) {
    for (const advertiserId of advertiserIds) {
      const rows = await fetchCampaignDailyRows({
        apiBaseUrl,
        accessToken,
        advertiserId,
        dateFrom: window.from,
        dateTo: window.to,
        fetchImpl,
      });

      for (const row of rows) {
        const record = normalizeMercadoLivreAdsRow({
          workspaceId: account.workspaceId,
          connectorAccountId: account.id,
          row,
        });
        if (!record || isEmptyAdsRecord(record)) continue;

        await prisma.dailyMetric.upsert({
          where: { dedupeHash: record.dedupeHash },
          update: record,
          create: record,
        });
        rowsUpserted += 1;
      }

      await sleep(MERCADO_LIVRE_ADS_REQUEST_THROTTLE_MS);
    }
  }

  return { rowsUpserted };
}
