import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  MetaApiError,
  normalizeMetaInsight,
  parseMetaBusinessUsageRetryAfter,
} from "@/lib/connectors/meta/client";
import { mapMetaInsightToDailyMetric } from "@/lib/connectors/meta/sync";

describe("Meta insights normalization", () => {
  it("extracts purchase metrics using omni_purchase before pixel purchase", () => {
    const insight = normalizeMetaInsight({
      campaign_id: "123",
      campaign_name: "Campanha W3",
      effective_status: "ACTIVE",
      configured_status: "PAUSED",
      objective: "OUTCOME_SALES",
      spend: "42.10",
      impressions: "1000",
      clicks: "120",
      actions: [
        { action_type: "omni_add_to_cart", value: "7" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
        { action_type: "omni_purchase", value: "3" },
      ],
      action_values: [{ action_type: "omni_purchase", value: "599.90" }],
      date_start: "2026-05-01",
      date_stop: "2026-05-01",
    });

    expect(insight).toMatchObject({
      campaignId: "123",
      campaignName: "Campanha W3",
      campaignStatus: "ACTIVE",
      campaignObjective: "OUTCOME_SALES",
      spend: "42.10",
      impressions: "1000",
      clicks: "120",
      addToCart: "7",
      conversions: "3",
      conversionsValue: "599.90",
    });
  });

  it("maps campaign insights to idempotent DailyMetric payloads", () => {
    const metric = mapMetaInsightToDailyMetric({
      workspaceId: "workspace-1",
      connectorAccountId: "connector-1",
      insight: {
        campaignId: "123",
        campaignName: "Campanha W3",
        campaignStatus: "ACTIVE",
        campaignObjective: "OUTCOME_SALES",
        spend: "42.10",
        impressions: "1000",
        clicks: "120",
        addToCart: "7",
        conversions: "3",
        conversionsValue: "599.90",
        leads: null,
        scheduledEvents: null,
        dateStart: "2026-05-01",
        dateStop: "2026-05-01",
      },
    });

    expect(metric.source).toBe(ConnectorProvider.META_ADS);
    expect(metric.campaignStatus).toBe("ACTIVE");
    expect(metric.campaignObjective).toBe("OUTCOME_SALES");
    expect(metric.addToCart).toBe(BigInt(7));
    expect(metric.impressions).toBe(BigInt(1000));
    expect(metric.clicks).toBe(BigInt(120));
    expect(metric.dedupeHash).toHaveLength(64);
  });

  it("turns high Meta business usage into a retry-after pause", () => {
    expect(
      parseMetaBusinessUsageRetryAfter(
        '{"ads_management":[{"call_count":80}]}',
      ),
    ).toBe("3600");
    expect(
      parseMetaBusinessUsageRetryAfter(
        '{"ads_management":[{"call_count":40}]}',
      ),
    ).toBeNull();
    expect(parseMetaBusinessUsageRetryAfter("not-json")).toBeNull();
  });

  it("keeps response headers on API errors so retry can honor Retry-After", () => {
    const headers = new Headers({ "retry-after": "2" });
    const error = new MetaApiError(429, "rate limit", headers);

    expect(error.response.status).toBe(429);
    expect(error.response.headers.get("retry-after")).toBe("2");
  });
});
