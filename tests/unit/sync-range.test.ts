import { describe, expect, it } from "vitest";

import {
  BACKFILL_BATCH_MONTHS,
  HISTORICAL_BACKFILL_DAYS,
  INCREMENTAL_FIRST_RUN_DAYS,
  INCREMENTAL_OVERLAP_MS,
  computeBackfillBatch,
  computeForegroundRange,
  computeIncrementalRange,
} from "@/lib/connectors/sync-range";

describe("computeForegroundRange", () => {
  it("returns from first day of current UTC month to today", () => {
    const now = new Date("2026-05-27T12:34:56.000Z");
    const range = computeForegroundRange(now);

    expect(range.since).toBe("2026-05-01T00:00:00.000Z");
    expect(range.until).toBe("2026-05-27T23:59:59.999Z");
  });

  it("on the first day of the month, since and until are both that day", () => {
    const now = new Date("2026-06-01T08:00:00.000Z");
    const range = computeForegroundRange(now);

    expect(range.since.slice(0, 10)).toBe("2026-06-01");
    expect(range.until.slice(0, 10)).toBe("2026-06-01");
  });
});

describe("computeBackfillBatch", () => {
  const now = new Date("2026-05-27T12:00:00.000Z");

  it("returns null when historicalSyncedAt is set", () => {
    const range = computeBackfillBatch({
      historicalSyncedAt: new Date("2026-05-26"),
      historicalBackfillUntil: new Date("2023-05-01"),
      now,
    });
    expect(range).toBeNull();
  });

  it("first batch: walks back BACKFILL_BATCH_MONTHS months from the current month", () => {
    const range = computeBackfillBatch({
      historicalSyncedAt: null,
      historicalBackfillUntil: null,
      now,
    });
    expect(range).not.toBeNull();
    expect(range!.since).toBe("2026-02-01T00:00:00.000Z");
    expect(range!.until.slice(0, 10)).toBe("2026-04-30");
  });

  it("next batch starts where historicalBackfillUntil leaves off", () => {
    const range = computeBackfillBatch({
      historicalSyncedAt: null,
      historicalBackfillUntil: new Date("2026-02-01T00:00:00.000Z"),
      now,
    });
    expect(range).not.toBeNull();
    expect(range!.since).toBe("2025-11-01T00:00:00.000Z");
    expect(range!.until.slice(0, 10)).toBe("2026-01-31");
  });

  it("clamps the last batch to the 3-year target without crossing it", () => {
    // Cursor 1 month above the target: should clamp the start to the target.
    const cursor = new Date("2023-06-01T00:00:00.000Z");
    const range = computeBackfillBatch({
      historicalSyncedAt: null,
      historicalBackfillUntil: cursor,
      now,
    });
    expect(range).not.toBeNull();
    // 1095 days before 2026-05-27 ≈ 2023-05-28 → monthStart = 2023-05-01.
    expect(range!.since).toBe("2023-05-01T00:00:00.000Z");
    expect(range!.until.slice(0, 10)).toBe("2023-05-31");
  });

  it("returns null once cursor reaches the 3-year target", () => {
    const targetMonth = new Date("2023-05-01T00:00:00.000Z");
    const range = computeBackfillBatch({
      historicalSyncedAt: null,
      historicalBackfillUntil: targetMonth,
      now,
    });
    expect(range).toBeNull();
  });

  it("constants reflect business rules", () => {
    expect(BACKFILL_BATCH_MONTHS).toBe(3);
    expect(HISTORICAL_BACKFILL_DAYS).toBe(1095);
  });
});

describe("computeIncrementalRange", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");

  it("re-scans from lastSyncedAt minus the overlap, by updated_at", () => {
    const range = computeIncrementalRange({
      lastSyncedAt: new Date("2026-06-30T09:00:00.000Z"),
      now,
    });
    // 48h overlap before lastSyncedAt.
    expect(range.since).toBe("2026-06-28T09:00:00.000Z");
    expect(range.until).toBe("2026-07-01T23:59:59.999Z");
    expect(range.dateField).toBe("updated_at");
    expect(range.paidOnly).toBe(false);
  });

  it("falls back to a lookback window on first run (no lastSyncedAt)", () => {
    const range = computeIncrementalRange({ lastSyncedAt: null, now });
    // 35 days before now.
    expect(range.since.slice(0, 10)).toBe("2026-05-27");
    expect(range.dateField).toBe("updated_at");
    expect(range.paidOnly).toBe(false);
  });

  it("constants reflect business rules", () => {
    expect(INCREMENTAL_OVERLAP_MS).toBe(48 * 60 * 60 * 1000);
    expect(INCREMENTAL_FIRST_RUN_DAYS).toBe(35);
  });
});
