import type { Metadata } from "next";

import { LineChartW3 } from "@/components/charts/line-chart-w3";
import { OperationalKpiCard } from "@/components/dashboards/operational-kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProviderLogo } from "@/components/providers/provider-logo";
import {
  formatCurrencyBR,
  formatIntegerBR,
  formatPercentBR,
  formatRoasBR,
} from "@/lib/utils/format-br";
import { getCurrentUserContext } from "@/lib/auth/current";
import {
  getGeneralOverview,
  type GeneralOverview,
} from "@/lib/metrics/general-overview";
import {
  DollarSign,
  ShoppingBag,
  Target,
  Ticket,
  TrendingUp,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Painel geral — W3 Marketplace",
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  TOKEN_EXPIRED: "Token expirado",
  REVOKED: "Revogada",
  ERROR: "Com erro",
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-[var(--success-bg)] text-[var(--success)]",
  TOKEN_EXPIRED: "bg-[var(--warning-bg)] text-[var(--warning)]",
  REVOKED: "bg-[var(--danger-bg)] text-[var(--danger)]",
  ERROR: "bg-[var(--danger-bg)] text-[var(--danger)]",
};

function relativeSync(date: Date | null) {
  if (!date) return "nunca";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d atrás`;
  return date.toLocaleDateString("pt-BR");
}

function MarketplacePanel({
  label,
  provider,
  revenue,
  orders,
  spend,
  roas,
}: {
  label: string;
  provider: GeneralOverview["byMarketplace"][number]["platform"];
  revenue: number;
  orders: number;
  spend: number;
  roas: number;
}) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-center gap-3">
        <ProviderLogo provider={provider} className="size-7" />
        <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          {label}
        </h3>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        <div className="col-span-2">
          <dt className="metric-label">Faturamento</dt>
          <dd className="mt-1 font-[var(--font-display)] text-3xl leading-none tracking-[-0.03em] text-[var(--metric-value)] [font-variant-numeric:tabular-nums]">
            {formatCurrencyBR(revenue)}
          </dd>
        </div>
        <div>
          <dt className="metric-label">Investimento</dt>
          <dd className="mt-1 text-lg font-medium text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
            {formatCurrencyBR(spend)}
          </dd>
        </div>
        <div>
          <dt className="metric-label">ROAS</dt>
          <dd
            className={`mt-1 text-lg font-medium [font-variant-numeric:tabular-nums] ${
              roas >= 3
                ? "text-[var(--success)]"
                : roas > 0
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-secondary)]"
            }`}
          >
            {roas > 0 ? formatRoasBR(roas) : "—"}
          </dd>
        </div>
        <div>
          <dt className="metric-label">Pedidos aprovados</dt>
          <dd className="mt-1 text-lg font-medium text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
            {formatIntegerBR(orders)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export default async function PainelGeralPage() {
  const context = await getCurrentUserContext();
  const overview = await getGeneralOverview({
    workspaceId: context.currentMembership.workspaceId,
  });

  const { kpis } = overview;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Painel geral
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Consolidação dos últimos 30 dias nos seus marketplaces, comparada com
          os 30 dias anteriores.
        </p>
      </div>

      {!overview.hasData ? (
        <Card className="p-8 text-center">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Sem dados sincronizados ainda
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
            Conecte suas contas Shopee e Mercado Livre em{" "}
            <a
              href="/connectors"
              className="font-medium text-[var(--w3-red)] underline-offset-2 hover:underline"
            >
              Conectores
            </a>{" "}
            e aguarde a primeira sincronização. Pedidos e investimento em mídia
            aparecem aqui automaticamente.
          </p>
        </Card>
      ) : (
        <>
          <section aria-label="Indicadores gerais" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <OperationalKpiCard
              accent="var(--w3-red)"
              icon={<DollarSign className="size-4" />}
              kpi={kpis.revenue}
              label="Faturamento"
              value={formatCurrencyBR(kpis.revenue.value)}
              previousValue={formatCurrencyBR(kpis.revenue.previousValue)}
            />
            <OperationalKpiCard
              accent="var(--w3-gold)"
              icon={<Target className="size-4" />}
              kpi={kpis.spend}
              label="Investimento em mídia"
              value={formatCurrencyBR(kpis.spend.value)}
              previousValue={formatCurrencyBR(kpis.spend.previousValue)}
            />
            <OperationalKpiCard
              accent={kpis.roas.value >= 3 ? "var(--success)" : "var(--danger)"}
              icon={<TrendingUp className="size-4" />}
              kpi={kpis.roas}
              label="ROAS médio"
              value={
                kpis.roas.value > 0 ? formatRoasBR(kpis.roas.value) : "—"
              }
              previousValue={
                kpis.roas.previousValue > 0
                  ? formatRoasBR(kpis.roas.previousValue)
                  : "—"
              }
            />
            <OperationalKpiCard
              accent="var(--info)"
              icon={<ShoppingBag className="size-4" />}
              kpi={kpis.orders}
              label="Pedidos"
              value={formatIntegerBR(kpis.orders.value)}
              previousValue={formatIntegerBR(kpis.orders.previousValue)}
            />
            <OperationalKpiCard
              compact
              icon={<Ticket className="size-4" />}
              kpi={kpis.averageOrderValue}
              label="Ticket médio"
              value={formatCurrencyBR(kpis.averageOrderValue.value)}
              previousValue={formatCurrencyBR(
                kpis.averageOrderValue.previousValue,
              )}
            />
          </section>

          <section aria-label="Comparação por marketplace" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {overview.byMarketplace.map((row) => (
              <MarketplacePanel
                key={row.platform}
                label={row.label}
                provider={row.platform}
                revenue={row.revenue}
                orders={row.orders}
                spend={row.spend}
                roas={row.roas}
              />
            ))}
          </section>

          <Card>
            <CardHeader className="mb-4">
              <CardTitle>Faturamento x Investimento — últimos 30 dias</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChartW3 data={overview.series} />
            </CardContent>
          </Card>

          <section aria-label="Campanhas com maior investimento" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="mb-4">
                <CardTitle>Campanhas por investimento</CardTitle>
              </CardHeader>
              <CardContent>
                {overview.campaigns.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
                    Nenhuma campanha com investimento no período.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
                        <th scope="col" className="pb-2 font-medium">Campanha</th>
                        <th scope="col" className="pb-2 text-right font-medium">Verba</th>
                        <th scope="col" className="pb-2 text-right font-medium">% total</th>
                        <th scope="col" className="pb-2 text-right font-medium">Cliques</th>
                      </tr>
                    </thead>
                    <tbody className="[font-variant-numeric:tabular-nums]">
                      {overview.campaigns.map((campaign) => (
                        <tr
                          key={campaign.campaignId}
                          className="border-b border-[var(--border-subtle)] last:border-b-0"
                        >
                          <td className="max-w-[220px] truncate py-2.5 pr-3 font-medium text-[var(--text-primary)]">
                            {campaign.campaignName ?? campaign.campaignId}
                          </td>
                          <td className="py-2.5 text-right text-[var(--text-secondary)]">
                            {formatCurrencyBR(campaign.spend)}
                          </td>
                          <td className="py-2.5 text-right text-[var(--text-secondary)]">
                            {formatPercentBR(campaign.spendSharePercent)}
                          </td>
                          <td className="py-2.5 text-right text-[var(--text-secondary)]">
                            {formatIntegerBR(campaign.clicks)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="mb-4">
                <CardTitle>Passagem de contas</CardTitle>
              </CardHeader>
              <CardContent>
                {overview.accounts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
                    Nenhuma conta conectada ainda.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {overview.accounts.map((account) => (
                      <li key={account.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <ProviderLogo
                            provider={account.provider}
                            className="size-5 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                              {account.accountName}
                            </span>
                            <span className="block text-xs text-[var(--text-tertiary,var(--text-secondary))] [font-variant-numeric:tabular-nums]">
                              Sync: {relativeSync(account.lastSyncedAt)}
                              {account.lastSyncError
                                ? ` · ${account.lastSyncError.slice(0, 60)}`
                                : ""}
                            </span>
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                            STATUS_STYLE[account.status] ?? STATUS_STYLE.ERROR
                          }`}
                        >
                          {STATUS_LABEL[account.status] ?? account.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
