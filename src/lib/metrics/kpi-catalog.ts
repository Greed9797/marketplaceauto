export type DashboardWidgetId =
  | "revenue"
  | "spend"
  | "roas_blended"
  | "orders"
  | "aov"
  | "cpa_blended"
  | "sessions"
  | "conversion_rate"
  | "top_campaigns"
  | "revenue_spend_line"
  | "funnel"
  | "source_distribution";

export type DashboardWidgetSize = "kpi" | "wide" | "table";

export type DashboardWidgetCatalogItem = {
  id: DashboardWidgetId;
  label: string;
  description: string;
  size: DashboardWidgetSize;
};

export type DashboardWidgetConfig = {
  instanceId: string;
  widgetId: DashboardWidgetId;
  params: Record<string, string>;
};

export type DashboardLayoutItem = {
  instanceId: string;
  order: number;
};

export const dashboardWidgetCatalog: DashboardWidgetCatalogItem[] = [
  {
    id: "revenue",
    label: "Faturamento",
    description: "Receita total de pedidos Shopify no período.",
    size: "kpi",
  },
  {
    id: "spend",
    label: "Investimento",
    description: "Soma de mídia paga em Meta e Google Ads.",
    size: "kpi",
  },
  {
    id: "roas_blended",
    label: "ROAS Blended",
    description: "Faturamento dividido pelo investimento total.",
    size: "kpi",
  },
  {
    id: "orders",
    label: "Pedidos",
    description: "Quantidade de pedidos no período.",
    size: "kpi",
  },
  {
    id: "aov",
    label: "AOV",
    description: "Ticket médio dos pedidos.",
    size: "kpi",
  },
  {
    id: "cpa_blended",
    label: "CPA Blended",
    description: "Investimento dividido pela quantidade de pedidos.",
    size: "kpi",
  },
  {
    id: "sessions",
    label: "Sessões",
    description: "Sessões atribuídas às fontes conectadas.",
    size: "kpi",
  },
  {
    id: "conversion_rate",
    label: "Conversão %",
    description: "Pedidos divididos por sessões.",
    size: "kpi",
  },
  {
    id: "top_campaigns",
    label: "Top Campanhas",
    description: "Ranking de campanhas por ROAS.",
    size: "table",
  },
  {
    id: "revenue_spend_line",
    label: "Linha Receita × Spend",
    description: "Série diária de faturamento e investimento.",
    size: "wide",
  },
  {
    id: "funnel",
    label: "Funil",
    description: "Impressões, cliques, sessões e pedidos.",
    size: "wide",
  },
  {
    id: "source_distribution",
    label: "Distribuição de fonte",
    description: "Participação de receita e investimento por fonte.",
    size: "wide",
  },
];

export const defaultWidgetIds: DashboardWidgetId[] = [
  "revenue",
  "spend",
  "roas_blended",
  "orders",
  "revenue_spend_line",
  "top_campaigns",
  "funnel",
];

export function resolveWidgetCatalogItem(id: string) {
  return dashboardWidgetCatalog.find((widget) => widget.id === id) ?? null;
}

export function defaultDashboardWidgets(ids: DashboardWidgetId[] = defaultWidgetIds) {
  return ids.map((widgetId) => ({
    instanceId: `widget-${widgetId}`,
    widgetId,
    params: {},
  })) satisfies DashboardWidgetConfig[];
}

export function createDashboardLayout(widgets: DashboardWidgetConfig[]) {
  return widgets.map((widget, order) => ({
    instanceId: widget.instanceId,
    order,
  })) satisfies DashboardLayoutItem[];
}

export function removeWidget(widgets: DashboardWidgetConfig[], instanceId: string) {
  return widgets.filter((widget) => widget.instanceId !== instanceId);
}

export function moveWidget(
  widgets: DashboardWidgetConfig[],
  instanceId: string,
  direction: "up" | "down",
) {
  const next = [...widgets];
  const index = next.findIndex((widget) => widget.instanceId === instanceId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }

  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function addWidget(widgets: DashboardWidgetConfig[], widgetId: DashboardWidgetId) {
  const item = resolveWidgetCatalogItem(widgetId);
  if (!item) {
    return widgets;
  }

  const instanceId = `widget-${widgetId}-${Date.now().toString(36)}`;
  return [
    ...widgets,
    {
      instanceId,
      widgetId,
      params: {},
    },
  ];
}
