import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { normalizeGoogleAdsMetricRow } from "@/lib/connectors/google-ads/client";
import {
  googleAdsTokenNeedsRefresh,
  mapGoogleAdsMetricToDailyMetric,
} from "@/lib/connectors/google-ads/sync";

describe("Google Ads metrics normalization", () => {
  it("converts cost micros and extracts campaign dimensions", () => {
    const metric = normalizeGoogleAdsMetricRow({
      campaign: { id: "123", name: "Search Marca" },
      metrics: {
        costMicros: "12340000",
        impressions: "1000",
        clicks: "120",
        conversions: 4.5,
        conversionsValue: 999.9,
      },
      segments: { date: "2026-05-01" },
    });

    expect(metric).toMatchObject({
      campaignId: "123",
      campaignName: "Search Marca",
      spend: "12.34",
      impressions: "1000",
      clicks: "120",
      conversions: "4.5",
      conversionsValue: "999.9",
      date: "2026-05-01",
    });
  });

  it("maps rows to idempotent DailyMetric payloads", () => {
    const payload = mapGoogleAdsMetricToDailyMetric({
      workspaceId: "workspace-1",
      connectorAccountId: "connector-1",
      metric: {
        campaignId: "123",
        campaignName: "Search Marca",
        spend: "12.34",
        impressions: "1000",
        clicks: "120",
        conversions: "4.5",
        conversionsValue: "999.9",
        date: "2026-05-01",
      },
    });

    expect(payload.source).toBe(ConnectorProvider.GOOGLE_ADS);
    expect(payload.impressions).toBe(BigInt(1000));
    expect(payload.clicks).toBe(BigInt(120));
    expect(payload.dedupeHash).toHaveLength(64);
  });

  it("refreshes Google Ads access tokens before they expire", () => {
    const now = new Date("2026-05-18T12:00:00.000Z");

    expect(googleAdsTokenNeedsRefresh(null, now)).toBe(false);
    expect(googleAdsTokenNeedsRefresh(new Date("2026-05-18T12:03:00.000Z"), now)).toBe(true);
    expect(googleAdsTokenNeedsRefresh(new Date("2026-05-18T12:20:00.000Z"), now)).toBe(false);
  });
});
