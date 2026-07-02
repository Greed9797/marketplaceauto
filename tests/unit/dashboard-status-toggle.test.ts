import { ConnectorProvider } from "@prisma/client";
import { describe, expect, test } from "vitest";

import { buildDashboardSnapshot } from "@/lib/metrics/aggregator";

const period = {
  preset: "custom" as const,
  from: new Date("2026-06-25T00:00:00.000Z"),
  to: new Date("2026-07-01T00:00:00.000Z"),
  comparison: {
    from: new Date("2026-06-18T00:00:00.000Z"),
    to: new Date("2026-06-24T00:00:00.000Z"),
  },
};

function order(status: string, total: string) {
  return {
    platform: ConnectorProvider.SHOPEE,
    status,
    orderTotal: total,
    itemsCount: 1,
    placedAt: new Date("2026-06-28T12:00:00.000Z"),
    orderCreatedAt: new Date("2026-06-28T12:00:00.000Z"),
  } as never;
}

describe("dashboard status toggle", () => {
  const orders = [
    order("paid", "100"),
    order("paid", "50"),
    order("cancelled", "40"),
    order("refunded", "10"),
  ];

  test("default (só pagos) conta apenas aprovados", () => {
    const snap = buildDashboardSnapshot({ period, orders, metrics: [] });
    expect(snap.kpis.orders.value).toBe(2);
    expect(snap.kpis.revenue.value).toBe(150);
  });

  test("includeAllStatuses conta todos os status", () => {
    const snap = buildDashboardSnapshot({
      period,
      orders,
      metrics: [],
      includeAllStatuses: true,
    });
    expect(snap.kpis.orders.value).toBe(4);
    expect(snap.kpis.revenue.value).toBe(200);
  });
});
