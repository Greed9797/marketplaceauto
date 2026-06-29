import { describe, expect, it } from "vitest";

import { formatCurrencyBR, formatIntegerBR, formatPercentBR, formatRoasBR } from "@/lib/utils/format-br";

describe("Brazilian formatters", () => {
  it("formats dashboard numbers in pt-BR", () => {
    expect(formatCurrencyBR(1234.56)).toBe("R$ 1.234,56");
    expect(formatIntegerBR(1234)).toBe("1.234");
    expect(formatPercentBR(12.345)).toBe("12.3%");
    expect(formatRoasBR(3.456)).toBe("3.46x");
  });
});
