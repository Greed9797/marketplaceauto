"use client";

import { Pause, Timer } from "lucide-react";

import { stopTimerAction } from "@/app/(app)/dashboards/timer-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration } from "@/lib/timer/duration";
import { useElapsedSeconds } from "@/components/timer/use-elapsed-seconds";

type TimerControlProps = {
  activeSession: {
    id: string;
    /** ISO timestamp — server source of truth, survives reloads. */
    startedAt: string;
    /** Brand the running session belongs to. */
    brandName: string;
  };
};

/**
 * Top banner shown only while a session is running, so Stop (with optional note)
 * is always reachable regardless of which brand card is on screen.
 */
export function TimerControl({ activeSession }: TimerControlProps) {
  const elapsed = useElapsedSeconds(activeSession.startedAt);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-[var(--bg-surface)] text-[var(--w3-red)]">
            <Timer aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-caption text-[var(--text-tertiary)]">
              Passagem de conta em andamento — {activeSession.brandName}
            </p>
            <p
              className="font-[var(--font-display)] text-2xl leading-none tracking-[-0.02em] text-[var(--metric-value)]"
              aria-live="polite"
            >
              {formatDuration(elapsed)}
            </p>
          </div>
        </div>

        <form
          action={stopTimerAction}
          className="flex flex-col gap-2 sm:items-end"
        >
          <input name="sessionId" type="hidden" value={activeSession.id} />
          <input
            name="note"
            type="text"
            maxLength={500}
            placeholder="O que foi feito nessa passagem? (opcional)"
            className="min-h-[44px] w-full rounded-md border border-[var(--border-strong)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] sm:w-80"
          />
          <Button type="submit" variant="destructive">
            <Pause aria-hidden className="size-4" />
            Parar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
