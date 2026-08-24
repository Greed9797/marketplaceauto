import type { DemandTaskStatus } from "@prisma/client";

export type DemandTimerState = {
  status: DemandTaskStatus;
  accumulatedSeconds: number;
  runningSince: Date | null;
};

export class DemandTimerError extends Error {
  constructor(
    public readonly code:
      | "invalid_transition"
      | "timer_already_running"
      | "task_not_found"
      | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "DemandTimerError";
  }
}

export function elapsedDemandSeconds(
  state: DemandTimerState,
  now = new Date(),
): number {
  if (state.status !== "RUNNING" || !state.runningSince) {
    return Math.max(0, state.accumulatedSeconds);
  }

  const openSegment = Math.max(
    0,
    Math.floor((now.getTime() - state.runningSince.getTime()) / 1000),
  );
  return Math.max(0, state.accumulatedSeconds) + openSegment;
}

export function startDemandTimer(now = new Date()) {
  return {
    status: "RUNNING" as const,
    runningSince: now,
    pausedAt: null,
    completedAt: null,
  };
}

export function pauseDemandTimer(state: DemandTimerState, now = new Date()) {
  if (state.status !== "RUNNING" || !state.runningSince) {
    throw new DemandTimerError(
      "invalid_transition",
      "Somente uma demanda em andamento pode ser pausada.",
    );
  }
  return {
    status: "PAUSED" as const,
    accumulatedSeconds: elapsedDemandSeconds(state, now),
    runningSince: null,
    pausedAt: now,
  };
}

export function resumeDemandTimer(state: DemandTimerState, now = new Date()) {
  if (state.status !== "PAUSED" || state.runningSince) {
    throw new DemandTimerError(
      "invalid_transition",
      "Somente uma demanda pausada pode ser retomada.",
    );
  }
  return {
    status: "RUNNING" as const,
    runningSince: now,
    pausedAt: null,
  };
}

export function completeDemandTimer(
  state: DemandTimerState,
  now = new Date(),
) {
  if (state.status !== "RUNNING" || !state.runningSince) {
    throw new DemandTimerError(
      "invalid_transition",
      "Retome o timer antes de concluir a demanda.",
    );
  }
  return {
    status: "DONE" as const,
    accumulatedSeconds: elapsedDemandSeconds(state, now),
    runningSince: null,
    pausedAt: null,
    completedAt: now,
  };
}

export function demandProgressPercent(
  elapsedSeconds: number,
  targetMinutes: number,
): number {
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) return 0;
  return Math.max(0, (elapsedSeconds / (targetMinutes * 60)) * 100);
}
