import { describe, expect, it } from "vitest";

import {
  buildDashboardDraft,
  serializeDashboardWidgets,
  parseDashboardWidgets,
} from "@/lib/dashboards/store";

describe("dashboard store helpers", () => {
  it("builds a dashboard draft with layout and widgets", () => {
    const draft = buildDashboardDraft({
      name: "Performance paga",
      ownerId: "user-1",
      widgetIds: ["revenue", "roas_blended", "top_campaigns"],
    });

    expect(draft.name).toBe("Performance paga");
    expect(draft.widgets).toHaveLength(3);
    expect(draft.layout).toEqual([
      { instanceId: "widget-revenue", order: 0 },
      { instanceId: "widget-roas_blended", order: 1 },
      { instanceId: "widget-top_campaigns", order: 2 },
    ]);
  });

  it("falls back to default widgets when JSON is invalid", () => {
    expect(parseDashboardWidgets("not-json").map((widget) => widget.widgetId)).toEqual([
      "revenue",
      "spend",
      "roas_blended",
      "orders",
      "revenue_spend_line",
      "top_campaigns",
      "funnel",
    ]);
  });

  it("serializes and parses widget configs", () => {
    const widgets = buildDashboardDraft({
      name: "Teste",
      ownerId: "user-1",
      widgetIds: ["revenue", "orders"],
    }).widgets;

    expect(parseDashboardWidgets(serializeDashboardWidgets(widgets))).toEqual(widgets);
  });
});
