/**
 * Pure helpers for the account-review timer. No DB / no React so they stay
 * trivially testable.
 */

/** Whole seconds elapsed between two instants, never negative. */
export function computeDurationSeconds(startedAt: Date, endedAt: Date): number {
  const ms = endedAt.getTime() - startedAt.getTime();
  return Math.max(0, Math.round(ms / 1000));
}

/** Formats a duration in seconds as `HH:MM:SS` (hours grow past 24h). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
