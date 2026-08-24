import type { ConnectorProvider } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export const ROAS_REPORT_WINDOWS = [7, 30, 90] as const;
export type RoasReportWindow = (typeof ROAS_REPORT_WINDOWS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfDayUTC(value: Date): Date {
  return new Date(`${isoDay(value)}T00:00:00.000Z`);
}

export type RoasReportPoint = {
  date: string;
  spend: number;
  revenue: number;
  orders: number;
  clicks: number;
  impressions: number;
};

export type RoasReportTotals = {
  spend: number;
  revenue: number;
  orders: number;
  /** revenue / spend; null quando não há investimento na janela. */
  roas: number | null;
  /** clicks / impressions; null quando não há impressões. */
  ctr: number | null;
};

export type RoasReport = {
  windowDays: number;
  source: ConnectorProvider | null;
  startDate: Date;
  endDate: Date;
  /** Primeiro dia com dado sincronizado (null = workspace vazio). */
  firstDataDate: string | null;
  /** true quando o histórico começa dentro da janela pedida (REPT-02). */
  partialHistory: boolean;
  days: RoasReportPoint[];
  totals: RoasReportTotals;
};

/**
 * Relatório de ROAS por janela (REPT-01..03).
 *
 * Investimento/cliques/impressões vêm de DailyMetric; receita e pedidos da
 * fonte de verdade de vendas (EcommerceOrder), com a mesma semântica de data
 * efetiva do agregador (orderCreatedAt ?? placedAt). Assim o relatório é
 * consistente entre plataformas mesmo que o relatório de ads não exponha
 * receita (caso da Shopee).
 */
export async function getRoasReport(input: {
  workspaceId: string;
  windowDays: number;
  source?: ConnectorProvider | null;
}): Promise<RoasReport> {
  const sourceFilter = input.source ?? null;
  const endDate = startOfDayUTC(new Date());
  const startDate = new Date(endDate.getTime() - (input.windowDays - 1) * DAY_MS);

  const metricWhere = {
    workspaceId: input.workspaceId,
    date: { gte: startDate },
    ...(sourceFilter ? { source: sourceFilter } : {}),
  };

  const orderWhereBase = {
    workspaceId: input.workspaceId,
    ...(sourceFilter ? { platform: sourceFilter } : {}),
  };

  const [metricRows, earliestRow, recentOrdersRows, legacyOrdersRows] =
    await Promise.all([
      prisma.dailyMetric.groupBy({
        by: ["date"],
        where: metricWhere,
        _sum: { spend: true, clicks: true, impressions: true },
      }),
      prisma.dailyMetric.findFirst({
        where: {
          workspaceId: input.workspaceId,
          ...(sourceFilter ? { source: sourceFilter } : {}),
        },
        orderBy: { date: "asc" },
        select: { date: true },
      }),
      prisma.ecommerceOrder.groupBy({
        by: ["orderCreatedAt"],
        where: {
          ...orderWhereBase,
          orderCreatedAt: { gte: startDate },
        },
        _sum: { orderTotal: true },
        _count: { _all: true },
      }),
      prisma.ecommerceOrder.groupBy({
        by: ["placedAt"],
        where: {
          ...orderWhereBase,
          orderCreatedAt: null,
          placedAt: { gte: startDate },
        },
        _sum: { orderTotal: true },
        _count: { _all: true },
      }),
    ]);

  const days = new Map<string, RoasReportPoint>();

  const pointFor = (key: string): RoasReportPoint => {
    let point = days.get(key);
    if (!point) {
      point = { date: key, spend: 0, revenue: 0, orders: 0, clicks: 0, impressions: 0 };
      days.set(key, point);
    }
    return point;
  };

  for (const row of metricRows) {
    const point = pointFor(isoDay(row.date));
    point.spend += Number(row._sum.spend ?? 0);
    point.clicks += Number(row._sum.clicks ?? 0);
    point.impressions += Number(row._sum.impressions ?? 0);
  }

  // Pedidos com orderCreatedAt: agrupados pelo próprio dia (groupBy em campo
  // datetime agrupa por timestamp — normalizamos para dia ao somar).
  for (const row of recentOrdersRows) {
    if (!row.orderCreatedAt) continue;
    const point = pointFor(isoDay(row.orderCreatedAt));
    point.revenue += Number(row._sum.orderTotal ?? 0);
    point.orders += row._count._all;
  }
  // Legado (orderCreatedAt null): cai para placedAt.
  for (const row of legacyOrdersRows) {
    const point = pointFor(isoDay(row.placedAt));
    point.revenue += Number(row._sum.orderTotal ?? 0);
    point.orders += row._count._all;
  }

  const orderedDays = [...days.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const totals = orderedDays.reduce<RoasReportTotals>(
    (acc, day) => ({
      spend: acc.spend + day.spend,
      revenue: acc.revenue + day.revenue,
      orders: acc.orders + day.orders,
      roas: null,
      ctr: null,
    }),
    { spend: 0, revenue: 0, orders: 0, roas: null, ctr: null },
  );
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

  const totalClicks = orderedDays.reduce((acc, day) => acc + day.clicks, 0);
  const totalImpressions = orderedDays.reduce(
    (acc, day) => acc + day.impressions,
    0,
  );
  totals.ctr =
    totalImpressions > 0 ? totalClicks / totalImpressions : null;

  const firstDataDate = earliestRow ? isoDay(earliestRow.date) : null;
  const partialHistory =
    firstDataDate !== null && new Date(firstDataDate) > startDate;

  return {
    windowDays: input.windowDays,
    source: sourceFilter,
    startDate,
    endDate,
    firstDataDate,
    partialHistory,
    days: orderedDays,
    totals,
  };
}
