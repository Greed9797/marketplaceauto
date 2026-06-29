import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import {
  addWidgetAction,
  moveWidgetAction,
  removeWidgetAction,
} from "@/app/(app)/dashboards/actions";
import { LineChartW3 } from "@/components/charts/line-chart-w3";
import { FunnelW3 } from "@/components/dashboards/funnel-w3";
import { TopCampaignsTable } from "@/components/dashboards/top-campaigns-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardSnapshot } from "@/lib/metrics/aggregator";
import {
  dashboardWidgetCatalog,
  resolveWidgetCatalogItem,
  type DashboardWidgetConfig,
  type DashboardWidgetId,
} from "@/lib/metrics/kpi-catalog";
import {
  formatCurrencyBR,
  formatIntegerBR,
  formatPercentBR,
  formatRoasBR,
} from "@/lib/utils/format-br";

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function widgetValue(widgetId: DashboardWidgetId, snapshot: DashboardSnapshot) {
  const revenue = snapshot.kpis.revenue.value;
  const spend = snapshot.kpis.spend.value;
  const orders = snapshot.kpis.orders.value;

  switch (widgetId) {
    case "revenue":
      return formatCurrencyBR(revenue);
    case "spend":
      return formatCurrencyBR(spend);
    case "roas_blended":
      return formatRoasBR(snapshot.kpis.roas.value);
    case "orders":
      return formatIntegerBR(orders);
    case "aov":
      return formatCurrencyBR(ratio(revenue, orders));
    case "cpa_blended":
      return formatCurrencyBR(ratio(spend, orders));
    case "sessions":
      // Use the pre-computed KPI (same value as funnel.sessions) for parity
      // with the other KPI widgets.
      return formatIntegerBR(snapshot.kpis.sessions.value);
    case "conversion_rate":
      return formatPercentBR(snapshot.kpis.conversionRate.value);
    default:
      return "";
  }
}

function SourceDistribution({ snapshot }: { snapshot: DashboardSnapshot }) {
  const revenue = snapshot.kpis.revenue.value;
  const spend = snapshot.kpis.spend.value;
  const orders = snapshot.kpis.orders.value;
  const max = Math.max(revenue, spend, orders, 1);
  const rows = [
    {
      label: "Receita Shopify",
      value: revenue,
      formatted: formatCurrencyBR(revenue),
    },
    {
      label: "Investimento Ads",
      value: spend,
      formatted: formatCurrencyBR(spend),
    },
    { label: "Pedidos", value: orders, formatted: formatIntegerBR(orders) },
  ];

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div className="grid gap-2" key={row.label}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">{row.label}</span>
            <span className="font-mono text-[var(--text-secondary)]">
              {row.formatted}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--bg-elevated)]">
            <div
              className="h-full rounded-[var(--radius-pill)] bg-[var(--w3-gold)]"
              style={{
                width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function WidgetBody({
  widget,
  snapshot,
}: {
  widget: DashboardWidgetConfig;
  snapshot: DashboardSnapshot;
}) {
  if (widget.widgetId === "revenue_spend_line") {
    return <LineChartW3 data={snapshot.lineSeries} />;
  }

  if (widget.widgetId === "top_campaigns") {
    return <TopCampaignsTable campaigns={snapshot.topCampaigns} />;
  }

  if (widget.widgetId === "funnel") {
    return <FunnelW3 funnel={snapshot.funnel} />;
  }

  if (widget.widgetId === "source_distribution") {
    return <SourceDistribution snapshot={snapshot} />;
  }

  return (
    <p className="text-kpi text-[var(--metric-value)]">
      {widgetValue(widget.widgetId, snapshot)}
    </p>
  );
}

export function DashboardWidgetRenderer({
  canEdit,
  dashboardId,
  snapshot,
  widgets,
}: {
  canEdit: boolean;
  dashboardId: string;
  snapshot: DashboardSnapshot;
  widgets: DashboardWidgetConfig[];
}) {
  if (!widgets.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-[var(--text-secondary)]">
          Este dashboard ainda não tem widgets.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {widgets.map((widget, index) => {
        const catalogItem = resolveWidgetCatalogItem(widget.widgetId);
        const isWide =
          catalogItem?.size === "wide" || catalogItem?.size === "table";

        return (
          <Card
            className={isWide ? "xl:col-span-2" : undefined}
            key={widget.instanceId}
          >
            <CardHeader>
              <div>
                <CardTitle className="metric-label">
                  {catalogItem?.label ?? widget.widgetId}
                </CardTitle>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {catalogItem?.description}
                </p>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-2">
                  <form action={moveWidgetAction}>
                    <input
                      name="dashboardId"
                      type="hidden"
                      value={dashboardId}
                    />
                    <input
                      name="instanceId"
                      type="hidden"
                      value={widget.instanceId}
                    />
                    <input name="direction" type="hidden" value="up" />
                    <Button
                      disabled={index === 0}
                      size="icon"
                      type="submit"
                      variant="ghost"
                    >
                      <ArrowUp aria-hidden className="size-4" />
                      <span className="sr-only">Subir widget</span>
                    </Button>
                  </form>
                  <form action={moveWidgetAction}>
                    <input
                      name="dashboardId"
                      type="hidden"
                      value={dashboardId}
                    />
                    <input
                      name="instanceId"
                      type="hidden"
                      value={widget.instanceId}
                    />
                    <input name="direction" type="hidden" value="down" />
                    <Button
                      disabled={index === widgets.length - 1}
                      size="icon"
                      type="submit"
                      variant="ghost"
                    >
                      <ArrowDown aria-hidden className="size-4" />
                      <span className="sr-only">Descer widget</span>
                    </Button>
                  </form>
                  <form action={removeWidgetAction}>
                    <input
                      name="dashboardId"
                      type="hidden"
                      value={dashboardId}
                    />
                    <input
                      name="instanceId"
                      type="hidden"
                      value={widget.instanceId}
                    />
                    <Button size="icon" type="submit" variant="ghost">
                      <Trash2 aria-hidden className="size-4" />
                      <span className="sr-only">Remover widget</span>
                    </Button>
                  </form>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              <WidgetBody snapshot={snapshot} widget={widget} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function WidgetCatalogList({ dashboardId }: { dashboardId: string }) {
  return (
    <div className="grid gap-3">
      {dashboardWidgetCatalog.map((widget) => (
        <form action={addWidgetAction} key={widget.id}>
          <input name="dashboardId" type="hidden" value={dashboardId} />
          <input name="widgetId" type="hidden" value={widget.id} />
          <Button
            className="h-auto w-full justify-start whitespace-normal py-3 text-left"
            type="submit"
            variant="secondary"
          >
            <span>
              <span className="block font-semibold">{widget.label}</span>
              <span className="block whitespace-normal text-xs font-normal text-[var(--text-secondary)]">
                {widget.description}
              </span>
            </span>
          </Button>
        </form>
      ))}
    </div>
  );
}
