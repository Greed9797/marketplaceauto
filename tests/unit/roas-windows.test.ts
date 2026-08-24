import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_LAG_HOURS,
  BASELINE_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  computeLaggedWindows,
  roasRatio,
} from "@/lib/notifications/roas-windows";

const NOW = new Date("2026-08-24T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeLaggedWindows", () => {
  it("desloca o corte em exatamente 72 horas (ROAS-05)", () => {
    const w = computeLaggedWindows(NOW);

    expect(w.cutoff.toISOString()).toBe("2026-08-21T12:00:00.000Z");
  });

  it("usa 72h como lag padrão", () => {
    const w = computeLaggedWindows(NOW);
    const explicit = computeLaggedWindows(NOW, 72);

    expect(w.cutoff.getTime()).toBe(explicit.cutoff.getTime());
    expect(ATTRIBUTION_LAG_HOURS).toBe(72);
  });

  it("aceita lag customizado", () => {
    const w = computeLaggedWindows(NOW, 48);

    expect(w.cutoff.toISOString()).toBe("2026-08-22T12:00:00.000Z");
  });

  it("janela recente tem 3 dias terminando no corte", () => {
    const w = computeLaggedWindows(NOW);

    expect((w.cutoff.getTime() - w.recentStart.getTime()) / DAY_MS).toBe(
      RECENT_WINDOW_DAYS,
    );
  });

  it("janela baseline tem 7 dias e é contígua à recente", () => {
    const w = computeLaggedWindows(NOW);

    expect(w.baselineEnd.getTime()).toBe(w.recentStart.getTime());
    expect(
      (w.baselineEnd.getTime() - w.baselineStart.getTime()) / DAY_MS,
    ).toBe(BASELINE_WINDOW_DAYS);
  });
});

describe("roasRatio", () => {
  // Cenário âncora da spec: ROAS 10 -> 3.
  it("calcula a razao recente/baseline", () => {
    expect(roasRatio(10, 3)).toBeCloseTo(0.3);
  });

  it("baseline invalido nunca alerta (razao 1)", () => {
    expect(roasRatio(0, 3)).toBe(1);
    expect(roasRatio(-1, 3)).toBe(1);
  });
});
