"use client";

import { Play } from "lucide-react";

import { startTimerAction } from "@/app/(app)/dashboards/timer-actions";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/timer/duration";
import { useElapsedSeconds } from "@/components/timer/use-elapsed-seconds";

type BrandTimerButtonProps = {
  workspaceId: string;
  /** Set when THIS brand has the running session; drives the live pill. */
  activeStartedAt: string | null;
};

/**
 * Per-brand timer control on a Marcas card. Idle → "Iniciar" (starts a session
 * bound to this brand). When this brand is the one running, shows a live pill;
 * stopping is done from the top banner (TimerControl).
 */
export function BrandTimerButton({
  workspaceId,
  activeStartedAt,
}: BrandTimerButtonProps) {
  const elapsed = useElapsedSeconds(activeStartedAt);

  if (activeStartedAt) {
    return (
      <span
        aria-live="polite"
        className="inline-flex items-center gap-2 rounded-md border border-[var(--w3-red)] px-3 py-1.5 text-xs font-semibold text-[var(--w3-red)]"
      >
        <span className="size-2 animate-pulse rounded-full bg-[var(--w3-red)]" />
        {formatDuration(elapsed)}
      </span>
    );
  }

  return (
    <form action={startTimerAction}>
      <input name="workspaceId" type="hidden" value={workspaceId} />
      <Button size="sm" type="submit" variant="ghost">
        <Play aria-hidden className="size-4" />
        Iniciar timer
      </Button>
    </form>
  );
}
