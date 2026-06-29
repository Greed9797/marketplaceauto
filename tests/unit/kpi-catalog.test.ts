import { describe, expect, it } from "vitest";

import {
  createDashboardLayout,
  dashboardWidgetCatalog,
  defaultDashboardWidgets,
  moveWidget,
  removeWidget,
  resolveWidgetCatalogItem,
} from "@/lib/metrics/kpi-catalog";

describe("dashboard widget catalog", () => {
  it("contains the 12 MVP widgets with unique ids", () => {
    const ids = dashboardWidgetCatalog.map((widget) => widget.id);

    expect(dashboardWidgetCatalog).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toEqual([
      "revenue",
      "spend",
      "roas_blended",
      "orders",
      "aov",
      "cpa_blended",
      "sessions",
      "conversion_rate",
      "top_campaigns",
      "revenue_spend_line",
      "funnel",
      "source_distribution",
    ]);
  });

  it("creates a stable vertical layout from selected widget ids", () => {
    const widgets = defaultDashboardWidgets(["revenue", "orders", "funnel"]);
    const layout = createDashboardLayout(widgets);

    expect(widgets.map((widget) => widget.instanceId)).toEqual([
      "widget-revenue",
      "widget-orders",
      "widget-funnel",
    ]);
    expect(layout).toEqual([
      { instanceId: "widget-revenue", order: 0 },
      { instanceId: "widget-orders", order: 1 },
      { instanceId: "widget-funnel", order: 2 },
    ]);
  });

  it("moves and removes widgets without mutating the original list", () => {
    const widgets = defaultDashboardWidgets(["revenue", "orders", "funnel"]);
    const moved = moveWidget(widgets, "widget-funnel", "up");
    const removed = removeWidget(widgets, "widget-orders");

    expect(moved.map((widget) => widget.instanceId)).toEqual([
      "widget-revenue",
      "widget-funnel",
      "widget-orders",
    ]);
    expect(removed.map((widget) => widget.instanceId)).toEqual([
      "widget-revenue",
      "widget-funnel",
    ]);
    expect(widgets.map((widget) => widget.instanceId)).toEqual([
      "widget-revenue",
      "widget-orders",
      "widget-funnel",
    ]);
  });

  it("resolves catalog metadata by id", () => {
    expect(resolveWidgetCatalogItem("roas_blended")?.label).toBe("ROAS Blended");
    expect(resolveWidgetCatalogItem("missing")).toBeNull();
  });
});
