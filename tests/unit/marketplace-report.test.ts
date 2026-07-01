import { describe, expect, it } from "vitest";

import { saoPauloDayRange, shiftDate } from "@/lib/reports/marketplace-report";
import { buildMarketplaceReportText } from "@/lib/reports/report-text";

describe("marketplace report — date helpers", () => {
  it("maps a São Paulo local day to a UTC [gte, lt) window (offset -03:00)", () => {
    const { gte, lt } = saoPauloDayRange("2026-06-23");
    // 00:00 -03:00 == 03:00Z; window is exactly 24h.
    expect(gte.toISOString()).toBe("2026-06-23T03:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-06-24T03:00:00.000Z");
  });

  it("shifts by whole days without drifting across the month boundary", () => {
    expect(shiftDate("2026-06-01", -1)).toBe("2026-05-31");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2026-06-23", -1)).toBe("2026-06-22");
  });
});

describe("marketplace report — text", () => {
  it("renders the exact WhatsApp layout with BRL formatting", () => {
    const text = buildMarketplaceReportText({
      referenceLabel: "23/06",
      faturamentoDiaAnterior: 12345.6,
      comissaoDiaAnterior: 617.28,
      clientesNovos: "3",
      churn: "1",
      clientesTotais: 42,
      comissaoAcumuladaYtd: 98765.43,
    });

    expect(text).toBe(
      [
        "*W3 MARKETPLACE* 🛍️",
        "Faturamento dia anterior: R$ 12.345,60",
        "Comissão dia anterior: R$ 617,28",
        "Clientes novos: 3",
        "Churn: 1",
        "",
        "CONSOLIDADO YTD. 23/06",
        "Clientes totais: 42",
        "Comissão acumulada: R$ 98.765,43",
      ].join("\n"),
    );
  });

  it("falls back to em dash for blank manual fields", () => {
    const text = buildMarketplaceReportText({
      referenceLabel: "01/07",
      faturamentoDiaAnterior: 0,
      comissaoDiaAnterior: 0,
      clientesNovos: "",
      churn: "   ",
      clientesTotais: 0,
      comissaoAcumuladaYtd: 0,
    });

    expect(text).toContain("Clientes novos: —");
    expect(text).toContain("Churn: —");
  });
});
