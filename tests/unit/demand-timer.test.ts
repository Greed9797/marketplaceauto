import { describe, expect, it } from "vitest";

import {
  completeDemandTimer,
  demandProgressPercent,
  elapsedDemandSeconds,
  pauseDemandTimer,
  resumeDemandTimer,
} from "@/lib/demands/timer";

const start = new Date("2026-08-24T12:00:00.000Z");

describe("demand timer", () => {
  it("reconstrói o tempo aberto usando o relógio do servidor", () => {
    expect(
      elapsedDemandSeconds(
        { status: "RUNNING", accumulatedSeconds: 30, runningSince: start },
        new Date("2026-08-24T12:01:10.000Z"),
      ),
    ).toBe(100);
  });

  it("pausa preservando o total acumulado", () => {
    expect(
      pauseDemandTimer(
        { status: "RUNNING", accumulatedSeconds: 10, runningSince: start },
        new Date("2026-08-24T12:00:50.000Z"),
      ),
    ).toMatchObject({ status: "PAUSED", accumulatedSeconds: 60, runningSince: null });
  });

  it("retoma sem apagar os segmentos anteriores", () => {
    expect(
      resumeDemandTimer(
        { status: "PAUSED", accumulatedSeconds: 60, runningSince: null },
        new Date("2026-08-24T13:00:00.000Z"),
      ),
    ).toMatchObject({ status: "RUNNING", runningSince: new Date("2026-08-24T13:00:00.000Z") });
  });

  it("exige retomar antes de concluir", () => {
    expect(() =>
      completeDemandTimer({ status: "PAUSED", accumulatedSeconds: 60, runningSince: null }),
    ).toThrow("Retome o timer");
  });

  it("fecha o segmento atual ao concluir", () => {
    expect(
      completeDemandTimer(
        { status: "RUNNING", accumulatedSeconds: 60, runningSince: start },
        new Date("2026-08-24T12:02:00.000Z"),
      ),
    ).toMatchObject({ status: "DONE", accumulatedSeconds: 180, runningSince: null });
  });

  it("calcula os marcos de 150% e 200% exatamente", () => {
    expect(demandProgressPercent(45 * 60, 30)).toBe(150);
    expect(demandProgressPercent(60 * 60, 30)).toBe(200);
  });
});
