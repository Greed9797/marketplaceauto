import { todayIso } from "./sync-helpers";

/**
 * Cap for the rolling historical backfill. Three years covers most growth
 * scenarios while staying within Meta's 37-month /insights hard cap.
 */
export const HISTORICAL_BACKFILL_DAYS = 1095;

/**
 * How many calendar months a single background backfill batch advances.
 * 3 months keeps each Vercel function well below the 240s deadline guard
 * even on the heaviest Meta accounts.
 */
export const BACKFILL_BATCH_MONTHS = 3;

/**
 * Per-provider slice width for backfill. High-volume, rate-limited providers
 * (iSET: ~1.4k orders/month, 3 req/s cap) only fit ~1 month per function call,
 * so a 3-month slice never completes and the cursor never advances. Lighter
 * providers keep the wider default.
 */
export function backfillBatchMonthsFor(provider: string): number {
  switch (provider) {
    case "ISET":
    case "NUVEMSHOP":
    case "MAGAZORD":
    case "WBUY":
    // Loja Integrada: 100 req/min per-store rate limit + 100 orders/page →
    // a wide window guarantees 429s on backfill, so slice to 1 month.
    case "LOJA_INTEGRADA":
      return 1;
    default:
      return BACKFILL_BATCH_MONTHS;
  }
}

export type SyncRange = {
  since: string;
  until: string;
};

function monthStartUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

/**
 * Foreground sync window: from the first day of the current UTC month to
 * the end of today. Always fast (≤30 days), used by login SWR triggers,
 * the cron job and the "Sincronizar agora" button.
 */
export function computeForegroundRange(now: Date = new Date()): SyncRange {
  return {
    since: monthStartUtc(now).toISOString(),
    until: todayIso(now),
  };
}

/**
 * Background backfill batch: the next chunk of older months that hasn't been
 * covered yet. Returns `null` when the full 3-year window has been reached.
 *
 * Walks the cursor backwards by {@link BACKFILL_BATCH_MONTHS} months at a
 * time. Callers should persist `historicalBackfillUntil` = `range.since`
 * after the sync helper succeeds.
 */
export function computeBackfillBatch(input: {
  historicalSyncedAt: Date | null;
  historicalBackfillUntil: Date | null;
  now?: Date;
  /** Override the slice width. Heavy/rate-limited providers (iSET) use 1 so a
   * batch always finishes inside the function budget. Defaults to 3. */
  batchMonths?: number;
}): SyncRange | null {
  const batchMonths = input.batchMonths ?? BACKFILL_BATCH_MONTHS;
  // "Done" only when BOTH the completion flag AND a real cursor are set. A
  // connector with historicalSyncedAt set but no historicalBackfillUntil is a
  // legacy/bad state (marked complete without ever running a batch) — treat it
  // as not-done so the backfill self-heals instead of being blocked forever.
  if (input.historicalSyncedAt && input.historicalBackfillUntil) return null;

  const now = input.now ?? new Date();
  const target = new Date(now);
  target.setUTCDate(target.getUTCDate() - HISTORICAL_BACKFILL_DAYS);
  const targetMonth = monthStartUtc(target);

  const cursor = input.historicalBackfillUntil
    ? monthStartUtc(input.historicalBackfillUntil)
    : monthStartUtc(now);

  if (cursor.getTime() <= targetMonth.getTime()) return null;

  const batchEnd = new Date(cursor);
  batchEnd.setUTCDate(batchEnd.getUTCDate() - 1);
  batchEnd.setUTCHours(23, 59, 59, 999);

  const batchStart = new Date(cursor);
  batchStart.setUTCMonth(batchStart.getUTCMonth() - batchMonths);

  const clampedStart =
    batchStart.getTime() < targetMonth.getTime() ? targetMonth : batchStart;

  return {
    since: clampedStart.toISOString(),
    until: batchEnd.toISOString(),
  };
}
