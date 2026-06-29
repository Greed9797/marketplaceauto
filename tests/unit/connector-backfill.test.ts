import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildBackfillRange,
  buildConnectorBackfillEvent,
} from "@/lib/connectors/backfill";

describe("connector backfill helpers", () => {
  it("builds a 90 day inclusive backfill window ending today", () => {
    const range = buildBackfillRange(new Date("2026-05-18T12:00:00.000Z"));

    expect(range).toEqual({
      since: "2026-02-17",
      until: "2026-05-18",
    });
  });

  it("maps connector providers to Inngest event names", () => {
    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.META_ADS,
        connectorAccountId: "connector-1",
        now: new Date("2026-05-18T12:00:00.000Z"),
      }),
    ).toEqual({
      name: "connector.meta.backfill",
      data: {
        connectorAccountId: "connector-1",
        range: {
          since: "2026-02-17",
          until: "2026-05-18",
        },
      },
    });

    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.GOOGLE_ADS,
        connectorAccountId: "connector-2",
        now: new Date("2026-05-18T12:00:00.000Z"),
      }).name,
    ).toBe("connector.google_ads.backfill");

    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.GA4,
        connectorAccountId: "connector-ga4",
        now: new Date("2026-05-18T12:00:00.000Z"),
      }).name,
    ).toBe("connector.google_analytics.backfill");

    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.SHOPIFY,
        connectorAccountId: "connector-3",
        now: new Date("2026-05-18T12:00:00.000Z"),
      }).name,
    ).toBe("connector.shopify.backfill");

    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.NUVEMSHOP,
        connectorAccountId: "connector-4",
        now: new Date("2026-05-18T12:00:00.000Z"),
      }).name,
    ).toBe("connector.ecommerce.backfill");
  });

  it("limits Shopify backfill to 60 days unless read_all_orders is configured", () => {
    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.SHOPIFY,
        connectorAccountId: "connector-3",
        now: new Date("2026-05-18T12:00:00.000Z"),
      }).data.range,
    ).toEqual({
      since: "2026-03-19",
      until: "2026-05-18",
    });

    expect(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.SHOPIFY,
        connectorAccountId: "connector-3",
        now: new Date("2026-05-18T12:00:00.000Z"),
        scopes: "read_orders,read_all_orders",
      }).data.range,
    ).toEqual({
      since: "2026-02-17",
      until: "2026-05-18",
    });
  });
});
