import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoasReportCard } from "@/app/(app)/relatorios/roas-report-card";
import type { RoasReport } from "@/lib/metrics/roas-report";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function buildReport(overrides: Partial<RoasReport> = {}): RoasReport {
  return {
    windowDays: 30,
    source: null,
    startDate: new Date("2026-07-26T00:00:00.000Z"),
    endDate: new Date("2026-08-24T00:00:00.000Z"),
    firstDataDate: "2026-05-01",
    partialHistory: false,
    days: [
      {
        date: "2026-08-23",
        spend: 100,
        revenue: 800,
        orders: 4,
        clicks: 70,
        impressions: 1500,
      },
      {
        date: "2026-08-24",
        spend: 50,
        revenue: 250,
        orders: 2,
        clicks: 20,
        impressions: 400,
      },
    ],
    totals: { spend: 150, revenue: 1050, orders: 6, roas: 7, ctr: 0.05 },
    ...overrides,
  };
}

beforeEach(() => {
  push.mockClear();
});

describe("RoasReportCard", () => {
  it("oferece as janelas 7/30/90 com a atual marcada (REPT-01)", () => {
    render(<RoasReportCard referenceDate="2026-08-24" report={buildReport()} />);

    for (const label of ["7 dias", "30 dias", "90 dias"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "30 dias" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("exibe totais de investimento, receita, ROAS, pedidos e CTR", () => {
    render(<RoasReportCard referenceDate="2026-08-24" report={buildReport()} />);

    expect(screen.getByText("R$ 150")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.050")).toBeInTheDocument();
    expect(screen.getByText("7x")).toBeInTheDocument();
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("navega ao trocar janela ou plataforma", () => {
    render(<RoasReportCard referenceDate="2026-08-24" report={buildReport()} />);

    fireEvent.click(screen.getByRole("button", { name: "7 dias" }));
    expect(push).toHaveBeenCalledWith("/relatorios?date=2026-08-24&janela=7");

    fireEvent.change(screen.getByLabelText("Plataforma"), {
      target: { value: "SHOPEE_ADS" },
    });
    expect(push).toHaveBeenCalledWith(
      "/relatorios?date=2026-08-24&janela=30&fonte=SHOPEE_ADS",
    );
  });

  it("avisa sobre historico parcial com a data de inicio (REPT-02)", () => {
    render(
      <RoasReportCard
        referenceDate="2026-08-24"
        report={buildReport({ partialHistory: true, firstDataDate: "2026-08-10" })}
      />,
    );

    expect(
      screen.getByText(/Histórico parcial: dados disponíveis a partir de/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/10\/08\/2026/)).toBeInTheDocument();
  });

  it("mostra estado vazio quando nao ha dados na janela (REPT-04)", () => {
    render(
      <RoasReportCard
        referenceDate="2026-08-24"
        report={buildReport({
          days: [],
          totals: {
            spend: 0,
            revenue: 0,
            orders: 0,
            roas: null,
            ctr: null,
          },
        })}
      />,
    );

    expect(screen.getByTestId("roas-empty")).toHaveTextContent(
      /Sem dados sincronizados/i,
    );
  });
});
