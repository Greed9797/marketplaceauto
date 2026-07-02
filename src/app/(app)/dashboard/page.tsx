import {
  BarChart3,
  Coins,
  Eye,
  MousePointerClick,
  PackageCheck,
  Percent,
  ReceiptText,
  ShoppingCart,
  Target,
  TrendingUp,
} from "lucide-react";
import { ConnectorProvider } from "@prisma/client";

import { DashboardAutoRefresh } from "@/components/dashboard/dashboard-auto-refresh";
import { DashboardFilterBar } from "@/components/dashboards/dashboard-filter-bar";
import { OperationalKpiCard } from "@/components/dashboards/operational-kpi-card";
import {
  CampaignsTable,
  CategoriesTable,
  ProductsTable,
  StateSalesTable,
} from "@/components/dashboards/operational-tables";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { MARKETPLACE_FIRST } from "@/lib/connectors/marketplace-first";
import { getDashboardSnapshot } from "@/lib/metrics/aggregator";
import { getDashboardFilters } from "@/lib/metrics/period";
import {
  formatCurrencyBR,
  formatIntegerBR,
  formatPercentBR,
  formatRoasBR,
} from "@/lib/utils/format-br";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardSeriesKey =
  | "revenue"
  | "spend"
  | "mediaRate"
  | "previousRevenue"
  | "previousSpend"
  | "previousMediaRate";

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const context = await getCurrentUserContext();

  const params = await searchParams;
  const filters = getDashboardFilters(params);
  const { period } = filters;
  const showComparison = filters.comparisonEnabled;
  const snapshot = await getDashboardSnapshot({
    workspaceId: context.currentWorkspace.id,
    period,
  });

  const empty = !snapshot.hasData;
  const chartSeries = (
    currentKey: DashboardSeriesKey,
    previousKey: DashboardSeriesKey,
  ) =>
    snapshot.lineSeries.map((item) => ({
      label: item.label,
      value: item[currentKey],
      previousValue: item[previousKey],
    }));
  // Marketplace-first surfaces the marketplace ad sources (Shopee Ads / Mercado
  // Livre Ads) in the campaign tables instead of the hidden paid-traffic
  // providers. Only the display selection changes here — the aggregation engine
  // is untouched — so the behavior is fully reversible via MARKETPLACE_FIRST.
  const campaignTables = MARKETPLACE_FIRST
    ? [
        {
          provider: ConnectorProvider.SHOPEE_ADS,
          title: "Campanhas Shopee Ads",
          description:
            "Performance das campanhas Shopee Ads no período selecionado.",
        },
        {
          provider: ConnectorProvider.MERCADO_LIVRE_ADS,
          title: "Campanhas Mercado Livre Ads",
          description:
            "Performance das campanhas Mercado Livre Ads no período selecionado.",
        },
      ]
    : [
        {
          provider: ConnectorProvider.META_ADS,
          title: "Campanhas Meta Ads",
          description: "Performance das campanhas Meta no período selecionado.",
        },
        {
          provider: ConnectorProvider.GOOGLE_ADS,
          title: "Campanhas Google Ads",
          description:
            "Performance das campanhas Google Ads no período selecionado.",
        },
      ];

  return (
    <div className="space-y-5">
      <DashboardAutoRefresh />
      <section>
        <DashboardFilterBar filters={filters} showProviderFilters={false} />
      </section>

      {snapshot.fetchError ? (
        <Card>
          <CardContent className="border border-dashed border-[var(--danger)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--danger)]">
            <strong>Erro ao carregar dados.</strong>{" "}
            {snapshot.fetchError === "schema_error"
              ? "Houve uma divergência de schema no banco. Avise o suporte."
              : "Houve uma falha de conexão com o banco. Tente novamente em instantes ou avise o suporte."}
          </CardContent>
        </Card>
      ) : null}

      {empty ? (
        <Card>
          <CardContent className="grid min-h-48 place-items-center border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-8 text-center">
            <div className="max-w-md">
              <BarChart3
                aria-hidden
                className="mx-auto mb-4 size-8 text-[var(--w3-red)]"
              />
              <h2 className="text-lg font-semibold">
                Sem dados nesse período.
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Tente outro intervalo ou conecte uma nova conta. Não vamos
                estimar valores para preencher visual.
              </p>
              <Button className="mt-5" asChild>
                <a href="/connectors">Conectar minha primeira conta</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* KPIs. Em marketplace-first, só métricas de VENDA (Faturamento, Qtd.
          de vendas, Ticket médio). As métricas de anúncio/tráfego pago (Valor
          investido, Custo de mídia, Custo por sessão, Taxa de conversão) só
          aparecem com MARKETPLACE_FIRST=false. */}
      <section className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <OperationalKpiCard
          accent="var(--w3-red)"
          icon={<ReceiptText aria-hidden className="size-4" />}
          kpi={snapshot.kpis.revenue}
          label="Faturamento"
          previousValue={formatCurrencyBR(snapshot.kpis.revenue.previousValue)}
          showComparison={showComparison}
          chart={{
            data: chartSeries("revenue", "previousRevenue"),
            format: "currency",
          }}
          value={formatCurrencyBR(snapshot.kpis.revenue.value)}
        />
        {MARKETPLACE_FIRST ? (
          <OperationalKpiCard
            accent="var(--w3-gold)"
            icon={<Coins aria-hidden className="size-4" />}
            kpi={snapshot.kpis.spend}
            label="Investimento"
            previousValue={formatCurrencyBR(snapshot.kpis.spend.previousValue)}
            showComparison={showComparison}
            chart={{
              data: chartSeries("spend", "previousSpend"),
              format: "currency",
            }}
            value={formatCurrencyBR(snapshot.kpis.spend.value)}
          />
        ) : null}
        <OperationalKpiCard
          accent="var(--success)"
          icon={<Target aria-hidden className="size-4" />}
          kpi={snapshot.kpis.roas}
          label="ROAS"
          previousValue={formatRoasBR(snapshot.kpis.roas.previousValue)}
          showComparison={showComparison}
          value={formatRoasBR(snapshot.kpis.roas.value)}
        />
        {!MARKETPLACE_FIRST ? (
          <OperationalKpiCard
            accent="var(--w3-gold)"
            icon={<TrendingUp aria-hidden className="size-4" />}
            kpi={snapshot.kpis.spend}
            label="Valor investido"
            previousValue={formatCurrencyBR(snapshot.kpis.spend.previousValue)}
            showComparison={showComparison}
            chart={{
              data: chartSeries("spend", "previousSpend"),
              format: "currency",
            }}
            value={formatCurrencyBR(snapshot.kpis.spend.value)}
          />
        ) : null}
        {!MARKETPLACE_FIRST ? (
          <OperationalKpiCard
            accent="var(--danger)"
            icon={<Percent aria-hidden className="size-4" />}
            kpi={snapshot.kpis.mediaRate}
            label="Custo de mídia"
            previousValue={formatPercentBR(
              snapshot.kpis.mediaRate.previousValue,
            )}
            showComparison={showComparison}
            chart={{
              data: chartSeries("mediaRate", "previousMediaRate"),
              format: "percent",
            }}
            value={formatPercentBR(snapshot.kpis.mediaRate.value)}
          />
        ) : null}
        <OperationalKpiCard
          accent="var(--w3-red)"
          compact
          icon={<ShoppingCart aria-hidden className="size-4" />}
          kpi={snapshot.kpis.orders}
          label="Qtd. de vendas"
          previousValue={formatIntegerBR(snapshot.kpis.orders.previousValue)}
          showComparison={showComparison}
          value={formatIntegerBR(snapshot.kpis.orders.value)}
        />
        <OperationalKpiCard
          accent="var(--info)"
          compact
          icon={<Eye aria-hidden className="size-4" />}
          kpi={snapshot.kpis.sessions}
          label="Visitas"
          previousValue={formatIntegerBR(snapshot.kpis.sessions.previousValue)}
          showComparison={showComparison}
          value={formatIntegerBR(snapshot.kpis.sessions.value)}
        />
        {!MARKETPLACE_FIRST ? (
          <OperationalKpiCard
            accent="var(--info)"
            compact
            icon={<MousePointerClick aria-hidden className="size-4" />}
            kpi={snapshot.kpis.costPerSession}
            label="Custo por sessão"
            previousValue={formatCurrencyBR(
              snapshot.kpis.costPerSession.previousValue,
            )}
            showComparison={showComparison}
            value={formatCurrencyBR(snapshot.kpis.costPerSession.value)}
          />
        ) : null}
        {!MARKETPLACE_FIRST ? (
          <OperationalKpiCard
            accent="var(--success)"
            compact
            icon={<MousePointerClick aria-hidden className="size-4" />}
            kpi={snapshot.kpis.conversionRate}
            label="Taxa de conversão"
            previousValue={formatPercentBR(
              snapshot.kpis.conversionRate.previousValue,
            )}
            showComparison={showComparison}
            value={formatPercentBR(snapshot.kpis.conversionRate.value)}
          />
        ) : null}
        <OperationalKpiCard
          accent="var(--w3-gold)"
          compact
          icon={<ShoppingCart aria-hidden className="size-4" />}
          kpi={snapshot.kpis.averageOrderValue}
          label="Ticket médio"
          previousValue={formatCurrencyBR(
            snapshot.kpis.averageOrderValue.previousValue,
          )}
          showComparison={showComparison}
          value={formatCurrencyBR(snapshot.kpis.averageOrderValue.value)}
        />
      </section>

      <section>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Total de vendas por Estado</CardTitle>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Distribuição de receita por UF a partir dos pedidos
                normalizados.
              </p>
            </div>
            <ReceiptText aria-hidden className="size-4 text-[var(--w3-red)]" />
          </CardHeader>
          <CardContent>
            <StateSalesTable states={snapshot.stateSales} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Produtos</CardTitle>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Produtos vendidos no período a partir dos itens de pedido
                normalizados.
              </p>
            </div>
            <PackageCheck aria-hidden className="size-4 text-[var(--w3-red)]" />
          </CardHeader>
          <CardContent>
            <ProductsTable products={snapshot.products} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Categorias</CardTitle>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Categorias que mais vendem no período. Itens sem categoria ficam
                agrupados em Sem categoria.
              </p>
            </div>
            <PackageCheck aria-hidden className="size-4 text-[var(--w3-red)]" />
          </CardHeader>
          <CardContent>
            <CategoriesTable categories={snapshot.categories} />
          </CardContent>
        </Card>
      </section>

      {/* Campanhas de anúncio: tráfego pago — oculto em marketplace-first. */}
      {!MARKETPLACE_FIRST ? (
        <section className="grid gap-4">
          {campaignTables.map((table) => (
            <Card key={table.provider}>
              <CardHeader>
                <div>
                  <CardTitle>{table.title}</CardTitle>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {table.description}
                  </p>
                </div>
                <TrendingUp
                  aria-hidden
                  className="size-4 text-[var(--w3-red)]"
                />
              </CardHeader>
              <CardContent>
                <CampaignsTable
                  campaigns={snapshot.topCampaigns.filter(
                    (campaign) => campaign.source === table.provider,
                  )}
                />
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  );
}
