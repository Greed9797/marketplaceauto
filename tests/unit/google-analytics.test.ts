import { describe, expect, it, vi } from "vitest";
import { ConnectorProvider } from "@prisma/client";

import { GoogleAnalyticsClient } from "@/lib/connectors/google-analytics/client";
import { buildGoogleAnalyticsOAuthUrl } from "@/lib/connectors/google-analytics/oauth";
import { mapGoogleAnalyticsSessionToDailyMetric } from "@/lib/connectors/google-analytics/sync";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.w3ads.com.br/api/connectors/google-analytics/callback",
};

describe("Google Analytics connector", () => {
  it("builds OAuth URL with analytics readonly scope", () => {
    const url = buildGoogleAnalyticsOAuthUrl({ state: "csrf", config });

    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/analytics.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("lists selectable GA4 properties from account summaries", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        accountSummaries: [
          {
            account: "accounts/123",
            displayName: "Conta Cliente",
            propertySummaries: [
              {
                property: "properties/456",
                displayName: "Loja GA4",
                propertyType: "PROPERTY_TYPE_ORDINARY",
              },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const client = new GoogleAnalyticsClient({ config, fetchImpl });

    await expect(client.listProperties("access-token")).resolves.toEqual([
      {
        propertyId: "456",
        propertyResourceName: "properties/456",
        accountResourceName: "accounts/123",
        accountName: "Conta Cliente",
        propertyName: "Loja GA4",
      },
    ]);
  });

  it("maps GA4 sessions into DailyMetric source GA4", () => {
    const metric = mapGoogleAnalyticsSessionToDailyMetric({
      workspaceId: "workspace",
      connectorAccountId: "ga4-property",
      metric: {
        date: "20260519",
        sourceMedium: "google / organic",
        sessions: "123",
      },
    });

    expect(metric).toMatchObject({
      source: ConnectorProvider.GA4,
      campaignId: "google / organic",
      campaignName: "google / organic",
      spend: null,
      sessions: BigInt(123),
    });
    expect(metric.date.toISOString()).toBe("2026-05-19T00:00:00.000Z");
  });
});
