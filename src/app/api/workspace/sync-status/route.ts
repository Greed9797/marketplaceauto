import { NextResponse } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight workspace sync-state probe for the dashboard auto-refresh poller.
 * Returns the latest sync timestamps so the client can detect when a
 * background sync (triggered by the app layout `after()`) has completed and
 * call `router.refresh()` to pull the fresh data.
 */
export async function GET() {
  try {
    const context = await getCurrentUserContext();
    const state = await prisma.workspaceSyncState.findUnique({
      where: { workspaceId: context.currentWorkspace.id },
      select: {
        lastSyncedAt: true,
        lastSyncStartedAt: true,
        lastSyncStatus: true,
      },
    });

    return NextResponse.json({
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      lastSyncStartedAt: state?.lastSyncStartedAt?.toISOString() ?? null,
      lastSyncStatus: state?.lastSyncStatus ?? null,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
