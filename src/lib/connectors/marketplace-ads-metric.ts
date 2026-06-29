import { createHash } from "node:crypto";
import { ConnectorProvider } from "@prisma/client";

/**
 * Shared mapping helpers for marketplace-native ad spend (Shopee Ads, Mercado
 * Livre Product Ads). These providers are NOT connected separately — they
 * piggyback on the parent marketplace account's OAuth token (see
 * `sync-ecommerce.ts`). Only traffic columns are populated: ads NEVER write
 * `revenue`/`orders` (revenue comes solely from `EcommerceOrder`), so ROAS is
 * never inflated by double-counting attributed GMV.
 */

export type MarketplaceAdsSyncRange = {
  since: string;
  until: string;
};

/**
 * A `DailyMetric` upsert payload for marketplace ad spend. `revenue` and
 * `orders` are pinned to `null` at the type level so the no-revenue guarantee
 * is enforced by the compiler, not just convention.
 */
export type AdsDailyMetricRecord = {
  workspaceId: string;
  connectorAccountId: string;
  date: Date;
  source: ConnectorProvider;
  campaignId: string | null;
  campaignName: string | null;
  spend: string;
  impressions: bigint;
  clicks: bigint;
  revenue: null;
  orders: null;
  dedupeHash: string;
};

/**
 * Mirrors the Meta ads dedupeHash scheme (see `meta/sync.ts`): includes
 * `source` so a SHOPEE_ADS row never collides with the SHOPEE revenue rollup
 * written under the same `connectorAccountId`, and `campaignId` so per-campaign
 * rows (Mercado Livre Product Ads) don't collide with each other.
 */
export function adsDailyMetricDedupeHash(input: {
  workspaceId: string;
  connectorAccountId: string;
  date: string;
  source: ConnectorProvider;
  campaignId: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        input.workspaceId,
        input.connectorAccountId,
        input.date,
        input.source,
        input.campaignId ?? "",
      ].join(":"),
    )
    .digest("hex");
}

/** Coerces an unknown API value to a finite number (0 when not parseable). */
export function toAdsNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Formats spend for the `Decimal(14,2)` column; never negative. */
export function toAdsDecimalString(value: number): string {
  return (Number.isFinite(value) ? Math.max(0, value) : 0).toFixed(2);
}

/** Rounds a count to a non-negative `BigInt` for the impressions/clicks columns. */
export function toAdsBigInt(value: number): bigint {
  return BigInt(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
}

/** A midnight-UTC `Date` for a `YYYY-MM-DD` key (matches the `@db.Date` column). */
export function asAdsDateOnly(dateKey: string): Date {
  return new Date(`${dateKey.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Normalizes an ISO-ish timestamp to a `YYYY-MM-DD` key, or `null` when it does
 * not parse (so the caller skips the row instead of dating it to now()).
 */
export function parseAdsIsoDate(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return Number.isNaN(Date.parse(`${key}T00:00:00.000Z`)) ? null : key;
}

/** True when a normalized row has no spend, impressions or clicks worth storing. */
export function isEmptyAdsRecord(record: AdsDailyMetricRecord): boolean {
  const zero = BigInt(0);
  return (
    Number(record.spend) <= 0 &&
    record.impressions <= zero &&
    record.clicks <= zero
  );
}
