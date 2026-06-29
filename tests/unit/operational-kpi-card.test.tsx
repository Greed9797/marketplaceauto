import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OperationalKpiCard } from "@/components/dashboards/operational-kpi-card";

const kpi = {
  value: 120,
  previousValue: 100,
  deltaPercent: 20,
};

describe("OperationalKpiCard", () => {
  it("hides previous value and delta when comparison is disabled", () => {
    render(
      <OperationalKpiCard
        icon={<span aria-hidden>i</span>}
        kpi={kpi}
        label="Faturamento"
        previousValue="R$ 100,00"
        showComparison={false}
        value="R$ 120,00"
      />,
    );

    expect(screen.getByText("R$ 120,00")).toBeInTheDocument();
    expect(screen.queryByText("/ R$ 100,00")).not.toBeInTheDocument();
    expect(screen.queryByText(/vs\. período anterior/i)).not.toBeInTheDocument();
  });
});
