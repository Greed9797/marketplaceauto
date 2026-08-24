import { ConnectorProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMocks } = vi.hoisted(() => ({
  prismaMocks: {
    dailyMetric: {
      groupBy: vi.fn(),
      findFirst: vi.fn(),
    },
    ecommerceOrder: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));

import { getRoasReport } from "@/lib/metrics/roas-report";

beforeEach(() => {
  vi.clearAllMocks();
  // Workspace sem dados por padrão.
  prismaMocks.dailyMetric.groupBy.mockResolvedValue([]);
  prismaMocks.dailyMetric.findFirst.mockResolvedValue(null);
  prismaMocks.ecommerceOrder.groupBy.mockResolvedValue([]);
});

describe("getRoasReport", () => {
  it("agrega série diária e totais com ROAS e CTR (REPT-01)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-24T15:00:00Z") });
    try {
      prismaMocks.dailyMetric.groupBy.mockResolvedValue([
        {
          date: new Date("2026-08-22T00:00:00.000Z"),
          _sum: { spend: 100, clicks: 40, impressions: 1000 },
        },
        {
          date: new Date("2026-08-23T00:00:00.000Z"),
          _sum: { spend: 50, clicks: 30, impressions: 500 },
        },
      ]);
      // Pedidos recentes (orderCreatedAt) no dia 22; legado (placedAt) no dia 23.
      prismaMocks.ecommerceOrder.groupBy.mockImplementation(
        async (args: { by: string[] }) => {
          if (args.by.includes("orderCreatedAt")) {
            return [
              {
                orderCreatedAt: new Date("2026-08-22T10:00:00.000Z"),
                _sum: { orderTotal: 600 },
                _count: { _all: 3 },
              },
            ];
          }
          return [
            {
              placedAt: new Date("2026-08-23T09:00:00.000Z"),
              _sum: { orderTotal: 200 },
              _count: { _all: 1 },
            },
          ];
        },
      );

      const report = await getRoasReport({
        workspaceId: "ws-1",
        windowDays: 7,
      });

      expect(report.days).toHaveLength(2);
      expect(report.days[0]).toMatchObject({
        date: "2026-08-22",
        spend: 100,
        revenue: 600,
        orders: 3,
      });
      expect(report.totals.spend).toBe(150);
      expect(report.totals.revenue).toBe(800);
      expect(report.totals.orders).toBe(4);
      expect(report.totals.roas).toBeCloseTo(800 / 150);
      expect(report.totals.ctr).toBeCloseTo(70 / 1500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marca histórico parcial quando o dado comeca dentro da janela (REPT-02)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-24T15:00:00Z") });
    try {
      prismaMocks.dailyMetric.findFirst.mockResolvedValue({
        date: new Date("2026-08-21T00:00:00.000Z"),
      });

      const report = await getRoasReport({
        workspaceId: "ws-1",
        windowDays: 30,
      });

      expect(report.firstDataDate).toBe("2026-08-21");
      expect(report.partialHistory).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nao marca parcial quando a janela cobre todo o historico", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-24T15:00:00Z") });
    try {
      prismaMocks.dailyMetric.findFirst.mockResolvedValue({
        date: new Date("2025-01-01T00:00:00.000Z"),
      });

      const report = await getRoasReport({
        workspaceId: "ws-1",
        windowDays: 7,
      });

      expect(report.partialHistory).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propaga o filtro de plataforma para metricas e pedidos (REPT-03)", async () => {
    await getRoasReport({
      workspaceId: "ws-1",
      windowDays: 7,
      source: ConnectorProvider.SHOPEE_ADS,
    });

    const metricWhere = (prismaMocks.dailyMetric.groupBy as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0].where;
    expect(metricWhere.source).toBe(ConnectorProvider.SHOPEE_ADS);

    const orderWhere = (
      prismaMocks.ecommerceOrder.groupBy as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0].where;
    expect(orderWhere.platform).toBe(ConnectorProvider.SHOPEE_ADS);
  });

  it("workspace vazio retorna serie vazia e totais zerados (REPT-04)", async () => {
    const report = await getRoasReport({ workspaceId: "ws-vazio", windowDays: 90 });

    expect(report.days).toEqual([]);
    expect(report.totals).toMatchObject({
      spend: 0,
      revenue: 0,
      orders: 0,
      roas: null,
      ctr: null,
    });
    expect(report.firstDataDate).toBeNull();
    expect(report.partialHistory).toBe(false);
  });
});
