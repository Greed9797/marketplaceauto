import { ConnectorProvider, ConnectorStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { detectShopeeAccountRoasDrop } from "@/lib/notifications/shopee-account-rule";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationDraft = {
  type: "roas_drop" | "low_stock" | "account_quality";
  severity: NotificationSeverity;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

// Uma notificação igual (type + entityId) por entidade a cada 24h — syncs
// rodam várias vezes ao dia e o inbox não pode virar spam. (isOnCooldown usa
// daysAgo(1), mesma janela.)

// Regra de queda de ROAS: campanha precisa ter gasto histórico relevante para
// baseline confiável, gasto recente real (não é pausa de verba), e performance
// prévia boa o bastante para a queda importar.
const ROAS_BASELINE_MIN_SPEND = 50;
const ROAS_RECENT_MIN_SPEND = 20;
const ROAS_BASELINE_MIN_ROAS = 3;
const ROAS_DROP_RATIO_WARNING = 0.5;
const ROAS_DROP_RATIO_CRITICAL = 0.25;

const LOW_STOCK_WARNING = 5;
const LOW_STOCK_CRITICAL = 2;

const MARKETPLACE_ADS_SOURCES: ConnectorProvider[] = [
  ConnectorProvider.SHOPEE_ADS,
  ConnectorProvider.MERCADO_LIVRE_ADS,
];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function isOnCooldown(
  workspaceId: string,
  draft: NotificationDraft,
  since: Date,
): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      workspaceId,
      type: draft.type,
      ...(draft.entityId ? { entityId: draft.entityId } : {}),
      createdAt: { gte: since },
    },
    select: { id: true },
  });

  return existing !== null;
}

async function persistDrafts(
  workspaceId: string,
  drafts: NotificationDraft[],
): Promise<number> {
  // Advisory lock por workspace: dois syncs concorrentes (cron + manual)
  // passariam no check-then-insert ao mesmo tempo e duplicariam o alerta.
  const since = daysAgo(1);
  let created = 0;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${workspaceId}`}))`;

    for (const draft of drafts) {
      if (await isOnCooldown(workspaceId, draft, since)) continue;

      await tx.notification.create({
        data: {
          workspaceId,
          type: draft.type,
          severity: draft.severity,
          title: draft.title,
          body: draft.body ?? null,
          entityType: draft.entityType ?? null,
          entityId: draft.entityId ?? null,
          metadata: draft.metadata ?? undefined,
        },
      });
      created += 1;
    }
  });

  return created;
}

type RoasWindow = { spend: number; revenue: number };

function roasOf(window: RoasWindow): number {
  if (window.spend <= 0) return 0;
  return window.revenue / window.spend;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

/**
 * Regra 1 — Queda brusca de ROAS por campanha (Shopee Ads / Mercado Livre Ads).
 * Compara a janela recente (3 dias) contra o baseline (7 dias anteriores).
 */
export async function detectRoasDrops(
  workspaceId: string,
): Promise<NotificationDraft[]> {
  // Cutoff único compartilhado pelas duas janelas — contíguas, sem gap.
  const recentStart = daysAgo(3);
  const baselineStart = daysAgo(10);
  const baselineEnd = recentStart;

  const rows = await prisma.dailyMetric.groupBy({
    by: ["campaignId", "campaignName"],
    where: {
      workspaceId,
      source: { in: MARKETPLACE_ADS_SOURCES },
      campaignId: { not: null },
      date: { gte: baselineStart },
    },
    _sum: { spend: true, revenue: true },
    // Janela completa por campanha; a separação recente/baseline é feita
    // abaixo com uma segunda query por janela (groupBy não suporta filtro
    // condicional por data no mesmo agregado).
  });

  if (rows.length === 0) return [];

  const campaignNameById = new Map<string, string | null>();
  for (const row of rows) {
    if (row.campaignId && !campaignNameById.has(row.campaignId)) {
      campaignNameById.set(row.campaignId, row.campaignName);
    }
  }

  const campaignIds = rows
    .map((row) => row.campaignId)
    .filter((id): id is string => Boolean(id));

  const [recentRows, baselineRows] = await Promise.all([
    prisma.dailyMetric.groupBy({
      by: ["campaignId"],
      where: {
        workspaceId,
        source: { in: MARKETPLACE_ADS_SOURCES },
        campaignId: { in: campaignIds },
        date: { gte: recentStart },
      },
      _sum: { spend: true, revenue: true },
    }),
    prisma.dailyMetric.groupBy({
      by: ["campaignId"],
      where: {
        workspaceId,
        source: { in: MARKETPLACE_ADS_SOURCES },
        campaignId: { in: campaignIds },
        date: { gte: baselineStart, lt: baselineEnd },
      },
      _sum: { spend: true, revenue: true },
    }),
  ]);

  const recentByCampaign = new Map<string, RoasWindow>();
  for (const row of recentRows) {
    if (!row.campaignId) continue;
    recentByCampaign.set(row.campaignId, {
      spend: Number(row._sum.spend ?? 0),
      revenue: Number(row._sum.revenue ?? 0),
    });
  }

  const baselineByCampaign = new Map<string, RoasWindow>();
  for (const row of baselineRows) {
    if (!row.campaignId) continue;
    baselineByCampaign.set(row.campaignId, {
      spend: Number(row._sum.spend ?? 0),
      revenue: Number(row._sum.revenue ?? 0),
    });
  }

  const drafts: NotificationDraft[] = [];

  for (const row of rows) {
    const campaignId = row.campaignId;
    if (!campaignId) continue;

    const baseline = baselineByCampaign.get(campaignId);
    const recent = recentByCampaign.get(campaignId) ?? { spend: 0, revenue: 0 };
    if (!baseline || baseline.spend < ROAS_BASELINE_MIN_SPEND) continue;
    if (recent.spend < ROAS_RECENT_MIN_SPEND) continue;

    const baselineRoas = roasOf(baseline);
    if (baselineRoas < ROAS_BASELINE_MIN_ROAS) continue;

    const recentRoas = roasOf(recent);
    const ratio = baselineRoas > 0 ? recentRoas / baselineRoas : 1;

    if (ratio >= ROAS_DROP_RATIO_WARNING) continue;

    const campaignName = campaignNameById.get(campaignId) ?? campaignId;
    const severity: NotificationSeverity =
      ratio < ROAS_DROP_RATIO_CRITICAL ? "critical" : "warning";

    drafts.push({
      type: "roas_drop",
      severity,
      title: `Queda de ROAS em "${campaignName}"`,
      body: `ROAS caiu de ${baselineRoas.toFixed(1)} para ${recentRoas.toFixed(1)} nos últimos 3 dias (baseline de 7 dias). Investimento recente: ${formatBRL(recent.spend)}. Vale investigar criativos, público e concorrência.`,
      entityType: "campaign",
      entityId: campaignId,
      metadata: {
        baselineRoas: Number(baselineRoas.toFixed(2)),
        recentRoas: Number(recentRoas.toFixed(2)),
        baselineSpend: baseline.spend,
        recentSpend: recent.spend,
      },
    });
  }

  return drafts;
}

/**
 * Regra 2 — Estoque baixo em anúncio ativo. Um criativo que vende e fica sem
 * estoque morre na plataforma; o alerta dá tempo de repor ou pausar.
 */
export async function detectLowStock(
  workspaceId: string,
): Promise<NotificationDraft[]> {
  const published = await prisma.produto.findMany({
    where: {
      cliente: { workspaceId },
      OR: [{ mlItemId: { not: null } }, { shopeeItemId: { not: null } }],
      status: "publicado",
    },
    select: {
      id: true,
      nomeOriginal: true,
      quantidade: true,
      mlItemId: true,
      shopeeItemId: true,
    },
  });

  if (published.length === 0) return [];

  // ProductInventory não tem FK para Produto — o vínculo é pelo ID externo
  // do item publicado (mesma chave usada pela tabela de produtos do dashboard).
  const externalIds = published
    .flatMap((p) => [p.mlItemId, p.shopeeItemId])
    .filter((id): id is string => Boolean(id));

  const inventoryRows = await prisma.productInventory.findMany({
    where: { workspaceId, externalProductId: { in: externalIds } },
    select: { externalProductId: true, quantity: true, syncedAt: true },
    orderBy: { syncedAt: "desc" },
  });

  const stockByExternalId = new Map<string, number | null>();
  for (const row of inventoryRows) {
    if (!stockByExternalId.has(row.externalProductId)) {
      stockByExternalId.set(row.externalProductId, row.quantity);
    }
  }

  const drafts: NotificationDraft[] = [];

  for (const produto of published) {
    const externalStocks = [produto.mlItemId, produto.shopeeItemId]
      .filter((id): id is string => Boolean(id))
      .map((id) => stockByExternalId.get(id))
      .filter((q): q is number | null => q !== undefined);

    // Estoque ao vivo quando existir; senão cai para a quantidade publicada.
    const tracked = externalStocks.filter((q) => q !== null) as number[];
    const liveStock = tracked.length > 0 ? Math.min(...tracked) : null;
    const effectiveStock =
      liveStock ?? (produto.quantidade > LOW_STOCK_WARNING ? null : produto.quantidade);

    if (effectiveStock === null || effectiveStock > LOW_STOCK_WARNING) continue;

    const severity: NotificationSeverity =
      effectiveStock <= LOW_STOCK_CRITICAL ? "critical" : "warning";
    const platforms = [
      produto.mlItemId ? "Mercado Livre" : null,
      produto.shopeeItemId ? "Shopee" : null,
    ].filter(Boolean);

    drafts.push({
      type: "low_stock",
      severity,
      title: `Estoque baixo: ${produto.nomeOriginal}`,
      body: `Restam ${effectiveStock} unidade(s) e o anúncio está ativo em ${platforms.join(" e ")}. Reprova estoque ou pause o anúncio para não matar a campanha.`,
      entityType: "produto",
      entityId: produto.id,
      metadata: {
        stock: effectiveStock,
        platforms,
      },
    });
  }

  return drafts;
}

/**
 * Regra 3 — Qualidade/saúde da conta. Conta revogada ou com token expirado
 * para de sincronizar em silêncio; o alerta cobra a reconexão antes do
 * prejuízo de dados.
 */
export async function detectAccountQualityIssues(
  workspaceId: string,
): Promise<NotificationDraft[]> {
  const accounts = await prisma.connectorAccount.findMany({
    where: {
      workspaceId,
      status: { not: ConnectorStatus.ACTIVE },
    },
    select: {
      id: true,
      provider: true,
      accountName: true,
      status: true,
      lastSyncError: true,
    },
  });

  return accounts.map((account) => ({
    type: "account_quality" as const,
    severity:
      account.status === ConnectorStatus.REVOKED
        ? ("critical" as const)
        : ("warning" as const),
    title: `Conta com problema: ${account.accountName}`,
    body:
      account.lastSyncError?.slice(0, 300) ??
      `A conta está com status ${account.status}. Reconecte em /connectors para retomar a sincronização.`,
    entityType: "connector",
    entityId: account.id,
    metadata: { provider: account.provider, status: account.status },
  }));
}

/**
 * Avalia todas as regras do workspace. Chamado ao final de cada sync —
 * nunca deve derrubar o sync: quem chama faz fire-and-forget com catch.
 */
export async function evaluateWorkspaceNotificationRules(
  workspaceId: string,
): Promise<number> {
  const [roasDrafts, stockDrafts, accountDrafts, shopeeAccountDrafts] =
    await Promise.all([
      detectRoasDrops(workspaceId).catch((error: unknown) => {
        console.error(
          `[notifications] roas rule failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        return [] as NotificationDraft[];
      }),
      detectLowStock(workspaceId).catch((error: unknown) => {
        console.error(
          `[notifications] stock rule failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        return [] as NotificationDraft[];
      }),
      detectAccountQualityIssues(workspaceId).catch((error: unknown) => {
        console.error(
          `[notifications] account rule failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        return [] as NotificationDraft[];
      }),
      // Regra de nível CONTA para Shopee Ads — o endpoint atual não expõe
      // campanha (ver design.md). Mesmo contrato de drafts/dedup das demais.
      detectShopeeAccountRoasDrop(workspaceId).catch((error: unknown) => {
        console.error(
          `[notifications] shopee account rule failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        return [] as NotificationDraft[];
      }),
    ]);

  return persistDrafts(workspaceId, [
    ...roasDrafts,
    ...stockDrafts,
    ...accountDrafts,
    ...shopeeAccountDrafts,
  ]);
}
