import { describe, expect, it } from "vitest";

import {
  RUNWAY_WINDOW_DAYS,
  averageUnitsPerDay,
  computeRunwayDays,
} from "@/lib/notifications/runway";

describe("averageUnitsPerDay", () => {
  it("divide o total pela janela de 14 dias", () => {
    expect(averageUnitsPerDay(28)).toBe(2);
    expect(RUNWAY_WINDOW_DAYS).toBe(14);
  });
});

describe("computeRunwayDays", () => {
  // Cenário âncora da spec (STCK-02): estoque 4, 2 vendas/dia -> ~2 dias.
  it("calcula dias restantes arredondando para cima", () => {
    expect(computeRunwayDays(4, 2)).toBe(2);
    expect(computeRunwayDays(5, 2)).toBe(3); // ceil(2.5)
    expect(computeRunwayDays(1, 3)).toBe(1); // ceil(0.33)
  });

  it("retorna 0 quando nao ha estoque mas ha venda", () => {
    expect(computeRunwayDays(0, 2)).toBe(0);
  });

  it("retorna null quando a media e zero ou indisponivel (STCK-04)", () => {
    expect(computeRunwayDays(10, 0)).toBeNull();
    expect(computeRunwayDays(10, null)).toBeNull();
    expect(computeRunwayDays(10, undefined)).toBeNull();
  });
});
