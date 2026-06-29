import { describe, expect, it } from "vitest";

import { ConnectorProvider } from "@prisma/client";

import {
  getDashboardFilters,
  getDashboardPeriod,
  toDateKey,
} from "@/lib/metrics/period";

describe("dashboard period", () => {
  it("builds the last 7 complete days (ending yesterday) with previous period", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );

    // Today (05-16) is excluded; window is the 7 complete days ending yesterday.
    expect(toDateKey(period.from)).toBe("2026-05-09");
    expect(toDateKey(period.to)).toBe("2026-05-15");
    expect(toDateKey(period.previousFrom)).toBe("2026-05-02");
    expect(toDateKey(period.previousTo)).toBe("2026-05-08");
    expect(toDateKey(period.comparison.from)).toBe("2026-05-02");
    expect(toDateKey(period.comparison.to)).toBe("2026-05-08");
    expect(period.comparison.source).toBe("previous");
    expect(period.days).toBe(7);
  });

  it("uses custom dates when both boundaries are valid", () => {
    const period = getDashboardPeriod(
      { period: "custom", from: "2026-04-01", to: "2026-04-15" },
      new Date("2026-05-16T12:00:00.000Z"),
    );

    expect(toDateKey(period.from)).toBe("2026-04-01");
    expect(toDateKey(period.to)).toBe("2026-04-15");
    expect(period.days).toBe(15);
    expect(period.label).toBe("01/04/2026 - 15/04/2026");
  });

  it("uses a manual comparison range when provided", () => {
    const period = getDashboardPeriod(
      {
        period: "custom",
        from: "2026-05-01",
        to: "2026-05-10",
        compareFrom: "2026-04-10",
        compareTo: "2026-04-19",
      },
      new Date("2026-05-16T12:00:00.000Z"),
    );

    expect(toDateKey(period.comparison.from)).toBe("2026-04-10");
    expect(toDateKey(period.comparison.to)).toBe("2026-04-19");
    expect(period.comparison.source).toBe("manual");
  });

  it("parses traffic and commerce provider filters", () => {
    // Marketplace-first: the visible traffic sources are the marketplace ad
    // providers (Shopee Ads / Mercado Livre Ads); Meta/Google Ads + GA4 are
    // hidden, so they are filtered out of the allowed selection.
    const filters = getDashboardFilters(
      {
        period: "month",
        traffic: "SHOPEE_ADS,MERCADO_LIVRE_ADS",
        commerce: "MERCADO_LIVRE,SHOPEE",
      },
      new Date("2026-05-16T12:00:00.000Z"),
    );

    expect(filters.trafficProviders).toEqual([
      ConnectorProvider.SHOPEE_ADS,
      ConnectorProvider.MERCADO_LIVRE_ADS,
    ]);
    expect(filters.commerceProviders).toEqual([
      ConnectorProvider.MERCADO_LIVRE,
      ConnectorProvider.SHOPEE,
    ]);
  });

  it("hides paid-traffic providers from the default in marketplace-first mode", () => {
    const filters = getDashboardFilters(
      { period: "month", traffic: "META_ADS,GOOGLE_ADS" },
      new Date("2026-05-16T12:00:00.000Z"),
    );

    // Explicitly requesting hidden providers yields the marketplace default,
    // never Meta/Google/GA4.
    expect(filters.trafficProviders).not.toContain(ConnectorProvider.META_ADS);
    expect(filters.trafficProviders).not.toContain(
      ConnectorProvider.GOOGLE_ADS,
    );
    expect(filters.trafficProviders).toEqual([
      ConnectorProvider.SHOPEE_ADS,
      ConnectorProvider.MERCADO_LIVRE_ADS,
    ]);
  });

  it("always reports comparison disabled (feature removed)", () => {
    const defaultFilters = getDashboardFilters(
      { period: "month" },
      new Date("2026-05-16T12:00:00.000Z"),
    );

    expect(defaultFilters.comparisonEnabled).toBe(false);
  });
});
