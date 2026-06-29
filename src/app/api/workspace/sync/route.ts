import { NextResponse } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { triggerWorkspaceSyncIfStale } from "@/lib/workspace/sync-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Real-time dashboard mode polls this endpoint. A 5-minute threshold caps how
// often a sync actually runs (vs the 30-min on-visit cooldown), so the data is
// never more than ~5 minutes stale while keeping connector API usage bounded.
const REALTIME_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Triggers a foreground workspace sync when the last sync is older than the
 * real-time threshold. Idempotent and self-throttling via
 * `triggerWorkspaceSyncIfStale` (atomic claim + cooldown), so concurrent
 * dashboards or rapid polls never start overlapping syncs.
 */
export async function POST() {
  try {
    const context = await getCurrentUserContext();
    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: context.currentWorkspace.id,
      triggeredBy: `realtime:${context.user.id}`,
      includeBackfill: false,
      thresholdMs: REALTIME_THRESHOLD_MS,
    });

    return NextResponse.json({
      triggered: result.triggered,
      reason: result.reason ?? null,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
