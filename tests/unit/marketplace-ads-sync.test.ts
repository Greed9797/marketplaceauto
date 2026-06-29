import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { adsDailyMetricDedupeHash } from "@/lib/connectors/marketplace-ads-metric";
import { normalizeMercadoLivreAdsRow } from "@/lib/connectors/mercado-livre-ads/sync";
import { normalizeShopeeAdsRow } from "@/lib/connectors/shopee-ads/sync";

const IDS = { workspaceId: "workspace-1", connectorAccountId: "connector-1" };

describe("Shopee Ads row normalization", () => {
  it("maps a daily CPC row to a SHOPEE_ADS DailyMetric shape (DD-MM-YYYY date)", () => {
    const record = normalizeShopeeAdsRow({
      ...IDS,
      row: {
        date: "01-05-2026",
        expense: "42.10",
        clicks: "120",
        impression: "1000",
        broad_gmv: "999.99",
        broad_order: "7",
      },
    });

    expect(record).not.toBeNull();
    expect(record?.source).toBe(ConnectorProvider.SHOPEE_ADS);
    expect(record?.date.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(record?.spend).toBe("42.10");
    expect(record?.impressions).toBe(BigInt(1000));
    expect(record?.clicks).toBe(BigInt(120));
    expect(record?.campaignId).toBeNull();
    expect(record?.dedupeHash).toHaveLength(64);
  });

  it("falls back to `cost` when `expense` is absent", () => {
    const record = normalizeShopeeAdsRow({
      ...IDS,
      row: { date: "2026-05-02", cost: 10, impressions: 50 },
    });

    expect(record?.spend).toBe("10.00");
    expect(record?.impressions).toBe(BigInt(50));
  });

  it("NEVER writes revenue or orders (broad_gmv is ignored)", () => {
    const record = normalizeShopeeAdsRow({
      ...IDS,
      row: { date: "01-05-2026", expense: "42.10", broad_gmv: "999.99" },
    });

    expect(record).not.toBeNull();
    expect(record?.revenue).toBeNull();
    expect(record?.orders).toBeNull();
    // Guard against any field accidentally carrying the attributed GMV.
    expect(Object.values(record ?? {})).not.toContain("999.99");
    expect(record?.spend).not.toBe("999.99");
  });

  it("returns null for a missing/invalid date", () => {
    expect(normalizeShopeeAdsRow({ ...IDS, row: { date: null } })).toBeNull();
    expect(
      normalizeShopeeAdsRow({ ...IDS, row: { date: "not-a-date" } }),
    ).toBeNull();
  });
});

describe("Mercado Livre Product Ads row normalization", () => {
  it("maps a daily campaign row to a MERCADO_LIVRE_ADS DailyMetric shape", () => {
    const record = normalizeMercadoLivreAdsRow({
      ...IDS,
      row: {
        date: "2026-05-01T00:00:00.000-03:00",
        cost: "12.34",
        prints: "500",
        clicks: "20",
        campaign_id: 777,
        campaign_name: "Promo Outono",
      },
    });

    expect(record).not.toBeNull();
    expect(record?.source).toBe(ConnectorProvider.MERCADO_LIVRE_ADS);
    expect(record?.date.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(record?.spend).toBe("12.34");
    expect(record?.impressions).toBe(BigInt(500));
    expect(record?.clicks).toBe(BigInt(20));
    expect(record?.campaignId).toBe("777");
    expect(record?.campaignName).toBe("Promo Outono");
    expect(record?.dedupeHash).toHaveLength(64);
  });

  it("leaves campaignId null when the report is account-level", () => {
    const record = normalizeMercadoLivreAdsRow({
      ...IDS,
      row: { date: "2026-05-01", cost: 5, prints: 9, clicks: 1 },
    });

    expect(record?.campaignId).toBeNull();
    expect(record?.campaignName).toBeNull();
  });

  it("NEVER writes revenue or orders", () => {
    const record = normalizeMercadoLivreAdsRow({
      ...IDS,
      row: { date: "2026-05-01", cost: 5, prints: 9, clicks: 1 },
    });

    expect(record?.revenue).toBeNull();
    expect(record?.orders).toBeNull();
  });

  it("returns null for a missing/invalid date", () => {
    expect(
      normalizeMercadoLivreAdsRow({ ...IDS, row: { date: undefined } }),
    ).toBeNull();
  });
});

describe("ads dedupeHash isolation", () => {
  it("does not collide between an ad source and the revenue rollup source", () => {
    const adsHash = adsDailyMetricDedupeHash({
      ...IDS,
      date: "2026-05-01",
      source: ConnectorProvider.SHOPEE_ADS,
      campaignId: null,
    });
    const rollupHash = adsDailyMetricDedupeHash({
      ...IDS,
      date: "2026-05-01",
      source: ConnectorProvider.SHOPEE,
      campaignId: null,
    });

    expect(adsHash).not.toBe(rollupHash);
  });

  it("separates per-campaign rows on the same day", () => {
    const base = {
      ...IDS,
      date: "2026-05-01",
      source: ConnectorProvider.MERCADO_LIVRE_ADS,
    };

    expect(adsDailyMetricDedupeHash({ ...base, campaignId: "a" })).not.toBe(
      adsDailyMetricDedupeHash({ ...base, campaignId: "b" }),
    );
  });
});
