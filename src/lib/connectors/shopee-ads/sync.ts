import { ConnectorProvider, type ConnectorAccount } from "@prisma/client";

import { connectorAccessTokenFromAccount } from "@/lib/connectors/credentials";
import {
  adsDailyMetricDedupeHash,
  asAdsDateOnly,
  isEmptyAdsRecord,
  toAdsBigInt,
  toAdsDecimalString,
  toAdsNumber,
  type AdsDailyMetricRecord,
  type MarketplaceAdsSyncRange,
} from "@/lib/connectors/marketplace-ads-metric";
import {
  buildShopeeConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { callWithRetry } from "@/lib/connectors/retry";
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import { type ShopeeConfig } from "@/lib/connectors/shopee/oauth";
import { signShopRequest } from "@/lib/connectors/shopee/signer";
import { prisma } from "@/lib/db/prisma";

type FetchLike = typeof fetch;

/** Shopee's CPC daily-performance report. */
const SHOPEE_ADS_DAILY_PERFORMANCE_PATH =
  "/api/v2/ads/get_all_cpc_ads_daily_performance";

/**
 * The report endpoint caps each query at ~30 days, so the requested range is
 * split into sub-windows of at most this many days (mirrors the w3saas edge
 * function, which used 29-day chunks).
 */
const SHOPEE_ADS_MAX_WINDOW_DAYS = 29;

/** Per-request delay (ms) to stay within Shopee's report rate-limit. */
const SHOPEE_ADS_REQUEST_THROTTLE_MS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One daily row from `get_all_cpc_ads_daily_performance`. Shopee returns spend
 * as `expense` (sometimes `cost`), impressions as `impression`, and attribution
 * GMV as `broad_gmv` — which we deliberately IGNORE (revenue is sourced only
 * from EcommerceOrder).
 */
export type ShopeeAdsDailyRow = {
  date?: string | null;
  expense?: number | string | null;
  cost?: number | string | null;
  clicks?: number | string | null;
  impression?: number | string | null;
  impressions?: number | string | null;
  broad_gmv?: number | string | null;
  broad_order?: number | string | null;
};

type ShopeeAdsResponse = {
  error?: string;
  message?: string;
  response?:
    | ShopeeAdsDailyRow[]
    | {
        daily_performance?: ShopeeAdsDailyRow[];
        data?: ShopeeAdsDailyRow[];
      }
    | null;
};

/**
 * Pure normalizer: a Shopee Ads daily row → a `DailyMetric` upsert payload, or
 * `null` when the date is missing/invalid. Spend/impressions/clicks only —
 * `revenue` and `orders` are pinned to `null`. Shopee's report is aggregated by
 * day (no campaign breakdown), so `campaignId` is always `null`.
 */
export function normalizeShopeeAdsRow(input: {
  workspaceId: string;
  connectorAccountId: string;
  row: ShopeeAdsDailyRow;
}): AdsDailyMetricRecord | null {
  const dateKey = parseShopeeAdsDate(input.row.date);
  if (!dateKey) return null;

  const spend = toAdsNumber(input.row.expense) || toAdsNumber(input.row.cost);
  const impressions =
    toAdsNumber(input.row.impression) || toAdsNumber(input.row.impressions);
  const clicks = toAdsNumber(input.row.clicks);

  return {
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    date: asAdsDateOnly(dateKey),
    source: ConnectorProvider.SHOPEE_ADS,
    campaignId: null,
    campaignName: null,
    spend: toAdsDecimalString(spend),
    impressions: toAdsBigInt(impressions),
    clicks: toAdsBigInt(clicks),
    revenue: null,
    orders: null,
    dedupeHash: adsDailyMetricDedupeHash({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      date: dateKey,
      source: ConnectorProvider.SHOPEE_ADS,
      campaignId: null,
    }),
  };
}

/**
 * Shopee's report uses (and returns) `DD-MM-YYYY`; we also accept `YYYY-MM-DD`
 * defensively. Returns a `YYYY-MM-DD` key or `null`.
 */
function parseShopeeAdsDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

/** `YYYY-MM-DD` → the `DD-MM-YYYY` format the Shopee report query expects. */
function toShopeeReportDate(dateKey: string): string {
  const [year, month, day] = dateKey.slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Splits [since, until] (YYYY-MM-DD) into <= 29-day sub-windows. */
function buildDayWindows(
  since: string,
  until: string,
): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  const endMs = asAdsDateOnly(until).getTime();
  let startMs = asAdsDateOnly(since).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return windows;
  }

  while (startMs <= endMs) {
    const windowEndMs = Math.min(
      startMs + (SHOPEE_ADS_MAX_WINDOW_DAYS - 1) * DAY_MS,
      endMs,
    );
    windows.push({
      start: new Date(startMs).toISOString().slice(0, 10),
      end: new Date(windowEndMs).toISOString().slice(0, 10),
    });
    startMs = windowEndMs + DAY_MS;
  }

  return windows;
}

function extractDailyRows(response: ShopeeAdsResponse): ShopeeAdsDailyRow[] {
  const payload = response.response;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    return payload.daily_performance ?? payload.data ?? [];
  }
  return [];
}

async function resolveShopeeConfig(workspaceId: string): Promise<ShopeeConfig> {
  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.SHOPEE,
  });
  const config = providerConfig
    ? await buildShopeeConfigFromProviderConfig(providerConfig)
    : getGlobalShopeeConfig(process.env.NEXTAUTH_URL?.trim() ?? "");

  if (!config) {
    throw new Error(
      "Configuração da Shopee ausente para sincronizar Shopee Ads (defina SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY ou um provider config do workspace).",
    );
  }

  return config;
}

async function fetchShopeeAdsRows(input: {
  config: ShopeeConfig;
  accessToken: string;
  shopId: number;
  startDate: string;
  endDate: string;
  fetchImpl: FetchLike;
}): Promise<ShopeeAdsDailyRow[]> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopRequest({
    partnerId: input.config.partnerId,
    partnerKey: input.config.partnerKey,
    apiPath: SHOPEE_ADS_DAILY_PERFORMANCE_PATH,
    timestamp,
    accessToken: input.accessToken,
    shopId: input.shopId,
  });

  const url = new URL(
    `${input.config.host}${SHOPEE_ADS_DAILY_PERFORMANCE_PATH}`,
  );
  url.searchParams.set("partner_id", String(input.config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("shop_id", String(input.shopId));
  url.searchParams.set("start_date", input.startDate);
  url.searchParams.set("end_date", input.endDate);

  const response = await callWithRetry(async () => {
    const res = await input.fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Shopee Ads API ${res.status}: ${body.slice(0, 200)}`);
    }
    return JSON.parse(body) as ShopeeAdsResponse;
  });

  if (typeof response.error === "string" && response.error.length > 0) {
    throw new Error(
      `Shopee Ads API error: ${response.error}${response.message ? ` - ${response.message}` : ""}`,
    );
  }

  return extractDailyRows(response);
}

/**
 * Syncs Shopee Ads daily spend into `DailyMetric` (source=SHOPEE_ADS) for the
 * parent SHOPEE connector. Reuses the parent account's (refresh-aware) access
 * token + the shop-request signer. Idempotent: rows are upserted by dedupeHash.
 */
export async function syncShopeeAdsDailyMetrics(input: {
  account: ConnectorAccount;
  range: MarketplaceAdsSyncRange;
  fetchImpl?: FetchLike;
}): Promise<{ rowsUpserted: number }> {
  const { account } = input;
  const shopId = Number(account.externalAccountId);
  if (!Number.isFinite(shopId) || shopId <= 0) {
    throw new Error("Shopee shop id (externalAccountId) is invalid");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const accessToken = await connectorAccessTokenFromAccount(account);
  const config = await resolveShopeeConfig(account.workspaceId);
  const windows = buildDayWindows(input.range.since, input.range.until);

  let rowsUpserted = 0;
  for (const window of windows) {
    const rows = await fetchShopeeAdsRows({
      config,
      accessToken,
      shopId,
      startDate: toShopeeReportDate(window.start),
      endDate: toShopeeReportDate(window.end),
      fetchImpl,
    });

    for (const row of rows) {
      const record = normalizeShopeeAdsRow({
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

    await sleep(SHOPEE_ADS_REQUEST_THROTTLE_MS);
  }

  return { rowsUpserted };
}
