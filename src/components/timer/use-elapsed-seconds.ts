"use client";

import { useEffect, useState } from "react";

/**
 * Live seconds elapsed since `startedAtIso` (the server's startedAt). Recomputed
 * from the timestamp each tick so the count is correct after reloads/tab
 * switches; pauses updates while the tab is hidden. Returns 0 when null.
 */
export function useElapsedSeconds(startedAtIso: string | null): number {
  const [elapsed, setElapsed] = useState(() =>
    startedAtIso
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(startedAtIso).getTime()) / 1000),
        )
      : 0,
  );

  useEffect(() => {
    if (!startedAtIso) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(startedAtIso).getTime();
    function tick() {
      if (document.visibilityState === "visible") {
        setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
      }
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAtIso]);

  return elapsed;
}
