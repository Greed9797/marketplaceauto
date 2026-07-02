import { describe, expect, it } from "vitest";
import { ConnectorProvider } from "@prisma/client";

import { buildDashboardSnapshot } from "@/lib/metrics/aggregator";
import { mapEcommerceOrdersToDailyMetricSummaries } from "@/lib/connectors/ecommerce-sync";
import { getDashboardPeriod } from "@/lib/metrics/period";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";

describe("NuvemShop June reconciliation by creation date", () => {
  const period = getDashboardPeriod(
    { period: "custom", from: "2026-06-01", to: "2026-06-30" },
    new Date("2026-07-15T12:00:00.000Z"),
  );

  it("sums paid, non-cancelled orders by orderCreatedAt (dashboard path)", () => {
    const snapshot = buildDashboardSnapshot({
      period,
      commerceProviders: [ConnectorProvider.NUVEMSHOP],
      metrics: [],
      orders: [
        // Created June, paid July → counts in June.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "500.00",
          status: "paid",
          orderCreatedAt: new Date("2026-06-10T13:00:00.000Z"),
          placedAt: new Date("2026-07-05T13:00:00.000Z"),
        },
        // paid_at empty → placedAt fell back to created_at (June); orderCreatedAt set.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "250.50",
          status: "paid",
          orderCreatedAt: new Date("2026-06-18T13:00:00.000Z"),
          placedAt: new Date("2026-06-18T13:00:00.000Z"),
        },
        // Cancelled → excluded.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "1000.00",
          status: "cancelado",
          orderCreatedAt: new Date("2026-06-02T13:00:00.000Z"),
          placedAt: new Date("2026-06-02T13:00:00.000Z"),
        },
        // BRT boundary: 2026-06-30 23:30 BRT = 2026-07-01T02:30Z → June.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "49.50",
          status: "paid",
          orderCreatedAt: new Date("2026-07-01T02:30:00.000Z"),
          placedAt: new Date("2026-07-01T02:30:00.000Z"),
        },
        // Created May → excluded from June.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "777.00",
          status: "paid",
          orderCreatedAt: new Date("2026-05-31T13:00:00.000Z"),
          placedAt: new Date("2026-06-01T13:00:00.000Z"),
        },
      ],
    });

    // 500 + 250.50 + 49.50 = 800.00.
    expect(snapshot.kpis.revenue.value).toBe(800);
    expect(snapshot.kpis.approvedOrders.value).toBe(3);
  });

  it("buckets the daily rollup by orderCreatedAt with placedAt fallback", () => {
    const orders: ShopifyOrder[] = [
      {
        externalOrderId: "a",
        orderNumber: null,
        orderTotal: "500.00",
        orderCurrency: "BRL",
        customerEmail: null,
        itemsCount: 1,
        status: "paid",
        orderCreatedAt: "2026-06-10T13:00:00.000Z",
        placedAt: "2026-07-05T13:00:00.000Z",
      },
      {
        externalOrderId: "b",
        orderNumber: null,
        orderTotal: "40.00",
        orderCurrency: "BRL",
        customerEmail: null,
        itemsCount: 1,
        status: "paid",
        orderCreatedAt: null,
        placedAt: "2026-06-20T13:00:00.000Z",
      },
    ];

    const summaries = mapEcommerceOrdersToDailyMetricSummaries({
      workspaceId: "w",
      connectorAccountId: "n1",
      provider: ConnectorProvider.NUVEMSHOP,
      orders,
    });

    const byDay = new Map(summaries.map((s) => [s.day, s.revenue]));
    // "a" buckets under its creation date (June 10), not the July paid date.
    expect(byDay.get("2026-06-10")).toBe("500.00");
    // "b" (null creation) falls back to placedAt (June 20).
    expect(byDay.get("2026-06-20")).toBe("40.00");
    expect(byDay.has("2026-07-05")).toBe(false);
  });
});
