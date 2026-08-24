import { ConnectorProvider } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  calculateDeltaPercent,
  calculateRoas,
} from "@/lib/metrics/aggregator";
import type { DashboardKpi } from "@/lib/metrics/aggregator";
import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

export const MARKETPLACE_PLATFORMS = [
  ConnectorProvider.SHOPEE,
  ConnectorProvider.MERCADO_LIVRE,
] as const;

const MARKETPLACE_ADS_SOURCES: ConnectorProvider[] = [
  ConnectorProvider.SHOPEE_ADS,
  ConnectorProvider.MERCADO_LIVRE_ADS,
];

// Mesma janela fixa do painel operacional por padrão (30 dias), com
// comparação contra os 30 dias anteriores.
const WINDOW_DAYS = 30;
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export type MarketplaceBreakdownRow = {
  platform: ConnectorProvider;
  label: string;
  revenue: number;
  orders: number;
  spend: number;
  roas: number;
};

export type GeneralOverviewSeriesPoint = {
  date: string;
  label: string;
  revenue: number;
  spend: number;
  previousRevenue: number;
  previousSpend: number;
};

export type GeneralAccountRow = {
  id: string;
  provider: ConnectorProvider;
  accountName: string;
  status: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

export type GeneralCampaignRow = {
  campaignId: string;
  campaignName: string | null;
  source: ConnectorProvider;
  spend: number;
  clicks: number;
  impressions: number;
  // Share do investimento total da janela (%) — a API de anúncios dos
  // marketplaces não expõe receita por campanha (revenue fica no pedido,
  // sem dupla contagem), então o ranque aqui é por verba investida.
  spendSharePercent: number;
};

export type GeneralOverview = {
  hasData: boolean;
  kpis: {
    revenue: DashboardKpi;
    spend: DashboardKpi;
    roas: DashboardKpi;
    orders: DashboardKpi;
    averageOrderValue: DashboardKpi;
  };
  byMarketplace: MarketplaceBreakdownRow[];
  series: GeneralOverviewSeriesPoint[];
  accounts: GeneralAccountRow[];
  campaigns: GeneralCampaignRow[];
};

function brtBound(date: Date): Date {
  return new Date(date.getTime() + BRT_OFFSET_MS);
}

function dayAfter(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function dateKeyBRT(date: Date): string {
  return new Date(date.getTime() + BRT_OFFSET_MS).toISOString().slice(0, 10);
}

function listWindowKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(from);
  while (cursor < to) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function labelForKey(key: string): string {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return WEEKDAY_LABELS[weekday];
}

type OrderAggregate = { approvedRevenue: number; approvedOrders: number };

function aggregateOrders(
  rows: Array<{
    platform: ConnectorProvider;
    orderTotal: PrismaDecimalLike;
    status: string;
    placedAt: Date | null;
    orderCreatedAt: Date | null;
  }>,
  from: Date,
  to: Date,
): { totals: OrderAggregate; byPlatform: Map<ConnectorProvider, OrderAggregate> } {
  const totals: OrderAggregate = { approvedRevenue: 0, approvedOrders: 0 };
  const byPlatform = new Map<ConnectorProvider, OrderAggregate>();

  for (const row of rows) {
    if (!isApprovedOrderStatus(row.status, row.platform)) continue;
    const bucket = row.orderCreatedAt ?? row.placedAt;
    if (!bucket || bucket < from || bucket >= to) continue;

    const value = Number(row.orderTotal);
    totals.approvedRevenue += value;
    totals.approvedOrders += 1;

    const platformTotals =
      byPlatform.get(row.platform) ??
      { approvedRevenue: 0, approvedOrders: 0 };
    platformTotals.approvedRevenue += value;
    platformTotals.approvedOrders += 1;
    byPlatform.set(row.platform, platformTotals);
  }

  return { totals, byPlatform };
}

type PrismaDecimalLike = { toString(): string } | number | null;

/**
 * Painel geral: consolida faturamento dos marketplaces (pedidos aprovados),
 * investimento em mídia marketplace (Shopee Ads / ML Ads), ROAS médio,
 * evolução diária e a "passagem de contas" (saúde das integrações).
 */
export async function getGeneralOverview(input: {
  workspaceId: string;
}): Promise<GeneralOverview> {
  const now = new Date();
  const currentTo = now;
  const currentFrom = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const previousFrom = new Date(currentFrom.getTime() - WINDOW_DAYS * 86_400_000);

  const [currentOrders, previousOrders, metrics, accounts] = await Promise.all([
    prisma.ecommerceOrder.findMany({
      where: {
        workspaceId: input.workspaceId,
        platform: { in: [...MARKETPLACE_PLATFORMS] },
        OR: [
          { orderCreatedAt: { gte: brtBound(currentFrom), lt: brtBound(dayAfter(currentTo)) } },
          {
            orderCreatedAt: null,
            placedAt: { gte: brtBound(currentFrom), lt: brtBound(dayAfter(currentTo)) },
          },
        ],
      },
      select: {
        platform: true,
        orderTotal: true,
        status: true,
        placedAt: true,
        orderCreatedAt: true,
      },
    }),
    prisma.ecommerceOrder.findMany({
      where: {
        workspaceId: input.workspaceId,
        platform: { in: [...MARKETPLACE_PLATFORMS] },
        OR: [
          { orderCreatedAt: { gte: brtBound(previousFrom), lt: brtBound(currentFrom) } },
          { orderCreatedAt: null, placedAt: { gte: brtBound(previousFrom), lt: brtBound(currentFrom) } },
        ],
      },
      select: {
        platform: true,
        orderTotal: true,
        status: true,
        placedAt: true,
        orderCreatedAt: true,
      },
    }),
    prisma.dailyMetric.findMany({
      where: {
        workspaceId: input.workspaceId,
        source: { in: MARKETPLACE_ADS_SOURCES },
        date: { gte: previousFrom },
      },
      select: {
        source: true,
        date: true,
        campaignId: true,
        campaignName: true,
        spend: true,
        clicks: true,
        impressions: true,
      },
    }),
    prisma.connectorAccount.findMany({
      where: { workspaceId: input.workspaceId },
      select: {
        id: true,
        provider: true,
        accountName: true,
        status: true,
        lastSyncedAt: true,
        lastSyncError: true,
      },
      orderBy: { accountName: "asc" },
    }),
  ]);

  const current = aggregateOrders(
    currentOrders,
    brtBound(currentFrom),
    brtBound(dayAfter(currentTo)),
  );
  const previous = aggregateOrders(
    previousOrders,
    brtBound(previousFrom),
    brtBound(currentFrom),
  );

  // Spend: janela atual vs anterior, por fonte e total.
  let currentSpend = 0;
  let previousSpend = 0;
  const spendBySourceCurrent = new Map<ConnectorProvider, number>();
  const currentKeys = listWindowKeys(currentFrom, dayAfter(currentTo));
  const previousKeys = listWindowKeys(previousFrom, currentFrom);
  const seriesByDay = new Map<string, { revenue: number; spend: number }>();
  const previousSeriesByDay = new Map<string, { revenue: number; spend: number }>();
  for (const key of currentKeys) {
    seriesByDay.set(key, { revenue: 0, spend: 0 });
  }
  for (const key of previousKeys) {
    previousSeriesByDay.set(key, { revenue: 0, spend: 0 });
  }

  for (const metric of metrics) {
    const key = dateKeyBRT(metric.date);
    const spend = Number(metric.spend ?? 0);

    if (metric.date >= previousFrom && metric.date < currentFrom) {
      previousSpend += spend;
      const prevPoint = previousSeriesByDay.get(key);
      if (prevPoint) prevPoint.spend += spend;
      continue;
    }
    if (metric.date < currentFrom) continue;

    currentSpend += spend;
    spendBySourceCurrent.set(
      metric.source,
      (spendBySourceCurrent.get(metric.source) ?? 0) + spend,
    );
    const point = seriesByDay.get(key);
    if (point) point.spend += spend;
  }

  // Receita diária (aprovada): janela atual e anterior.
  for (const row of [...currentOrders, ...previousOrders]) {
    if (!isApprovedOrderStatus(row.status, row.platform)) continue;
    const bucket = row.orderCreatedAt ?? row.placedAt;
    if (!bucket) continue;

    const key = dateKeyBRT(bucket);
    const inCurrent = bucket >= currentFrom;
    const target = inCurrent ? seriesByDay : previousSeriesByDay;
    const point = target.get(key);
    if (!point) continue;
    point.revenue += Number(row.orderTotal);
  }


  const currentRevenue = current.totals.approvedRevenue;
  const previousRevenue = previous.totals.approvedRevenue;
  const roasKpi: DashboardKpi = {
    value: calculateRoas(currentRevenue, currentSpend),
    previousValue: calculateRoas(previousRevenue, previousSpend),
    deltaPercent: calculateDeltaPercent(
      calculateRoas(currentRevenue, currentSpend),
      calculateRoas(previousRevenue, previousSpend),
    ),
  };

  const byMarketplace: MarketplaceBreakdownRow[] = MARKETPLACE_PLATFORMS.map(
    (platform) => {
      const platformTotals = current.byPlatform.get(platform) ?? {
        approvedRevenue: 0,
        approvedOrders: 0,
      };
      const adsSource =
        platform === ConnectorProvider.SHOPEE
          ? ConnectorProvider.SHOPEE_ADS
          : ConnectorProvider.MERCADO_LIVRE_ADS;
      const spend = spendBySourceCurrent.get(adsSource) ?? 0;

      return {
        platform,
        label:
          platform === ConnectorProvider.SHOPEE ? "Shopee" : "Mercado Livre",
        revenue: platformTotals.approvedRevenue,
        orders: platformTotals.approvedOrders,
        spend,
        roas: calculateRoas(platformTotals.approvedRevenue, spend),
      };
    },
  );

  // Campanhas: agrupa por campaignId na janela atual, ranqueadas por verba.
  const campaignsByKey = new Map<string, GeneralCampaignRow>();

  for (const metric of metrics) {
    if (!metric.campaignId || metric.date < currentFrom) continue;

    const entry = campaignsByKey.get(metric.campaignId) ?? {
      campaignId: metric.campaignId,
      campaignName: metric.campaignName,
      source: metric.source,
      spend: 0,
      clicks: 0,
      impressions: 0,
      spendSharePercent: 0,
    };

    entry.spend += Number(metric.spend ?? 0);
    entry.clicks += Number(metric.clicks ?? 0);
    entry.impressions += Number(metric.impressions ?? 0);
    campaignsByKey.set(metric.campaignId, entry);
  }

  const campaigns = [...campaignsByKey.values()]
    .filter((row) => row.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
    .map((row) => ({
      ...row,
      spendSharePercent:
        currentSpend > 0 ? Math.round((row.spend / currentSpend) * 1000) / 10 : 0,
    }));

  const hasData =
    currentRevenue > 0 || currentSpend > 0 || previousRevenue > 0 || previousSpend > 0;

  return {
    hasData,
    kpis: {
      revenue: {
        value: currentRevenue,
        previousValue: previousRevenue,
        deltaPercent: calculateDeltaPercent(currentRevenue, previousRevenue),
      },
      spend: {
        value: currentSpend,
        previousValue: previousSpend,
        deltaPercent: calculateDeltaPercent(currentSpend, previousSpend),
      },
      roas: roasKpi,
      orders: {
        value: current.totals.approvedOrders,
        previousValue: previous.totals.approvedOrders,
        deltaPercent: calculateDeltaPercent(
          current.totals.approvedOrders,
          previous.totals.approvedOrders,
        ),
      },
      averageOrderValue: {
        value:
          current.totals.approvedOrders > 0
            ? currentRevenue / current.totals.approvedOrders
            : 0,
        previousValue:
          previous.totals.approvedOrders > 0
            ? previousRevenue / previous.totals.approvedOrders
            : 0,
        deltaPercent: calculateDeltaPercent(
          current.totals.approvedOrders > 0
            ? currentRevenue / current.totals.approvedOrders
            : 0,
          previous.totals.approvedOrders > 0
            ? previousRevenue / previous.totals.approvedOrders
            : 0,
        ),
      },
    },
    byMarketplace,
    series: currentKeys.map((date, index) => {
      const values = seriesByDay.get(date) ?? { revenue: 0, spend: 0 };
      const previous =
        previousSeriesByDay.get(previousKeys[index]) ??
        { revenue: 0, spend: 0 };
      return {
        date,
        label: labelForKey(date),
        revenue: Math.round(values.revenue * 100) / 100,
        spend: Math.round(values.spend * 100) / 100,
        previousRevenue: Math.round(previous.revenue * 100) / 100,
        previousSpend: Math.round(previous.spend * 100) / 100,
      };
    }),
    accounts: accounts.sort((a, b) => {
      const statusWeight = (status: string) =>
        status === "ACTIVE" ? 1 : 0;
      return (
        statusWeight(a.status) - statusWeight(b.status) ||
        (b.lastSyncedAt?.getTime() ?? 0) - (a.lastSyncedAt?.getTime() ?? 0)
      );
    }),
    campaigns,
  };
}
