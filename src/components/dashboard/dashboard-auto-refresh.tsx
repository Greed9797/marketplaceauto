"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 8000;
// The live-sync loop triggers a workspace sync at most this often. Kept under
// the 5-minute freshness target the product requires while bounding connector
// API usage.
const REALTIME_SYNC_MS = 4 * 60 * 1000;

type SyncStatus = {
  lastSyncedAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncStatus: string | null;
};

/**
 * Polls the workspace sync status and calls `router.refresh()` once a
 * background sync completes (lastSyncedAt advances past the value the page was
 * rendered with). This is what makes the dashboard update on its own after the
 * app-layout `after()` background sync writes new data — without it the user
 * only sees fresh data after a manual reload or Sync Now.
 *
 * It also POSTs the workspace sync trigger on mount and every REALTIME_SYNC_MS
 * so fresh store data is pulled on a ≤5-minute cadence regardless of the
 * selected period; the status poll above then refreshes the view as soon as
 * the sync lands. (The dedicated "Tempo Real" preset was removed — this live
 * cadence now applies to every period filter.)
 *
 * Renders nothing. Polling pauses while the tab is hidden to avoid waste.
 */
export function DashboardAutoRefresh({
  initialSyncedAt,
}: {
  /** Optional render-time baseline. When omitted the first poll self-baselines. */
  initialSyncedAt?: string | null;
}) {
  const router = useRouter();
  const baselineRef = useRef<string | null>(initialSyncedAt ?? null);
  const initializedRef = useRef<boolean>(initialSyncedAt !== undefined);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (!active) return;

      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/workspace/sync-status", {
            cache: "no-store",
          });
          if (res.ok) {
            const data = (await res.json()) as SyncStatus;
            const latest = data.lastSyncedAt;
            if (!initializedRef.current) {
              // First reading establishes the baseline; never refresh on it.
              baselineRef.current = latest;
              initializedRef.current = true;
            } else if (latest && latest !== baselineRef.current) {
              baselineRef.current = latest;
              router.refresh();
            }
          }
        } catch {
          // Transient network errors are ignored; next tick retries.
        }
      }

      timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function triggerSync() {
      if (!active) return;
      if (document.visibilityState === "visible") {
        try {
          // Self-throttled server-side (5-min threshold + atomic claim), so a
          // call that lands inside the window is a cheap no-op.
          await fetch("/api/workspace/sync", {
            method: "POST",
            cache: "no-store",
          });
        } catch {
          // Ignored; next tick retries.
        }
      }
      timer = setTimeout(triggerSync, REALTIME_SYNC_MS);
    }

    // Kick once on mount, then on the interval.
    triggerSync();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return null;
}
