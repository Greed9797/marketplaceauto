import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

import type { NotificationDraft } from "./rules";
import { computeLaggedWindows, roasRatio } from "./roas-windows";

// Limiares espelham a regra por campanha (rules.ts) — mesmos pisos e cortes
// definidos na spec. Import por valor geraria ciclo runtime quando o
// avaliador passar a chamar esta regra; `import type` mantém isso seguro.
const BASELINE_MIN_SPEND = 50;
const RECENT_MIN_SPEND = 20;
const BASELINE_MIN_ROAS = 3;
const DROP_RATIO_WARNING = 0.5;
const DROP_RATIO_CRITICAL = 0.25;

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

/**
 * Regra de queda brusca de ROAS no nível CONTA (Shopee Ads).
 *
 * O endpoint atual da Shopee (`get_all_cpc_ads_daily_performance`) é
 * agregado por dia sem campaignId, então a granularidade possível é a conta.
 * Receita vem dos pedidos sincronizados (EcommerceOrder) — o relatório da
 * Shopee traz GMV de atribuição que ignoramos de propósito. As janelas
 * excluem as últimas 72h (attribution lag) antes de agregar.
 */
export async function detectShopeeAccountRoasDrop(
  workspaceId: string,
): Promise<NotificationDraft[]> {
  const { recentStart, recentEnd, baselineStart, baselineEnd } =
    computeLaggedWindows(new Date());

  const accounts = await prisma.connectorAccount.findMany({
    where: {
      workspaceId,
      provider: ConnectorProvider.SHOPEE_ADS,
      status: ConnectorStatus.ACTIVE,
    },
    select: { id: true, accountName: true },
  });

  if (accounts.length === 0) return [];

  const accountIds = accounts.map((account) => account.id);

  const spendWhere = (
    gte: Date,
    lt: Date,
  ): Prisma.DailyMetricWhereInput => ({
    workspaceId,
    source: ConnectorProvider.SHOPEE_ADS,
    connectorAccountId: { in: accountIds },
    date: { gte, lt },
  });

  // Data efetiva do pedido = orderCreatedAt quando existir; placedAt como
  // fallback legado (mesma semântica do agregador de faturamento).
  const effectiveDateFilter = (
    gte: Date,
    lt: Date,
  ): Prisma.EcommerceOrderWhereInput["OR"] => [
    { orderCreatedAt: { gte, lt } },
    { AND: [{ orderCreatedAt: null }, { placedAt: { gte, lt } }] },
  ];

  const [recentSpendRows, baselineSpendRows, recentRevenueRows, baselineRevenueRows] =
    await Promise.all([
      prisma.dailyMetric.groupBy({
        by: ["connectorAccountId"],
        where: spendWhere(recentStart, recentEnd),
        _sum: { spend: true },
      }),
      prisma.dailyMetric.groupBy({
        by: ["connectorAccountId"],
        where: spendWhere(baselineStart, baselineEnd),
        _sum: { spend: true },
      }),
      prisma.ecommerceOrder.groupBy({
        by: ["connectorAccountId"],
        where: {
          workspaceId,
          connectorAccountId: { in: accountIds },
          OR: effectiveDateFilter(recentStart, recentEnd),
        },
        _sum: { orderTotal: true },
      }),
      prisma.ecommerceOrder.groupBy({
        by: ["connectorAccountId"],
        where: {
          workspaceId,
          connectorAccountId: { in: accountIds },
          OR: effectiveDateFilter(baselineStart, baselineEnd),
        },
        _sum: { orderTotal: true },
      }),
    ]);

  const sumByAccount = (
    rows: Array<{ connectorAccountId: string; _sum: Record<string, unknown> }>,
    accountId: string,
    field: string,
  ): number =>
    toNumber(
      rows.find((row) => row.connectorAccountId === accountId)?._sum[field],
    );

  const drafts: NotificationDraft[] = [];

  for (const account of accounts) {
    const baselineSpend = sumByAccount(baselineSpendRows, account.id, "spend");
    const recentSpend = sumByAccount(recentSpendRows, account.id, "spend");

    if (baselineSpend < BASELINE_MIN_SPEND) continue;
    if (recentSpend < RECENT_MIN_SPEND) continue;

    const baselineRevenue = sumByAccount(
      baselineRevenueRows,
      account.id,
      "orderTotal",
    );
    const recentRevenue = sumByAccount(
      recentRevenueRows,
      account.id,
      "orderTotal",
    );

    const baselineRoas = baselineRevenue / baselineSpend;
    if (baselineRoas < BASELINE_MIN_ROAS) continue;

    const recentRoas = recentSpend > 0 ? recentRevenue / recentSpend : 0;
    const ratio = roasRatio(baselineRoas, recentRoas);

    if (ratio >= DROP_RATIO_WARNING) continue;

    const severity =
      ratio < DROP_RATIO_CRITICAL ? ("critical" as const) : ("warning" as const);

    drafts.push({
      type: "roas_drop",
      severity,
      title: `Queda de ROAS na conta "${account.accountName}"`,
      body: `ROAS da conta Shopee caiu de ${baselineRoas.toFixed(1)} para ${recentRoas.toFixed(1)} nos últimos 3 dias (baseline de 7 dias, atribuição de até 72h já compensada). Investimento recente: ${formatBRL(recentSpend)}. Vale revisar criativos, preços e concorrência.`,
      entityType: "connector_account",
      entityId: account.id,
      metadata: {
        scope: "account",
        provider: ConnectorProvider.SHOPEE_ADS,
        baselineRoas: Number(baselineRoas.toFixed(2)),
        recentRoas: Number(recentRoas.toFixed(2)),
        baselineSpend,
        recentSpend,
      },
    });
  }

  return drafts;
}
