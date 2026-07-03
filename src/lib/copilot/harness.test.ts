import { describe, expect, it } from "vitest";

import { combineScore, shouldStop } from "./harness";

describe("combineScore", () => {
  it("uses completude alone when juiz is null", () => {
    expect(combineScore(70, null)).toBe(70);
  });

  it("averages completude and juiz, rounded", () => {
    expect(combineScore(80, 90)).toBe(85);
    expect(combineScore(81, 90)).toBe(86); // 85.5 → 86
  });

  it("clamps out-of-range inputs to 0-100", () => {
    expect(combineScore(120, -5)).toBe(50); // (100 + 0)/2
  });
});

describe("shouldStop", () => {
  it("stops only when score >= threshold AND publicavel", () => {
    expect(shouldStop({ score: 90, publicavel: true, threshold: 85 })).toBe(
      true,
    );
    expect(shouldStop({ score: 90, publicavel: false, threshold: 85 })).toBe(
      false,
    );
    expect(shouldStop({ score: 80, publicavel: true, threshold: 85 })).toBe(
      false,
    );
  });
});
