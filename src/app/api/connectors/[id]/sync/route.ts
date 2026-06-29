import { ConnectorStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canAddWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { SYNC_HELPERS } from "@/lib/connectors/sync-helpers";
import { computeForegroundRange } from "@/lib/connectors/sync-range";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const userContext = await getCurrentUserContext();

  if (
    !canAddWorkspaceConnectors(
      userContext.user,
      userContext.currentMembership.role,
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const account = await prisma.connectorAccount.findUnique({
    where: { id },
    select: {
      id: true,
      workspaceId: true,
      provider: true,
      status: true,
    },
  });

  if (!account) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  if (account.workspaceId !== userContext.currentWorkspace.id) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  // A revoked (soft-deleted) connector must not be resurrected to ACTIVE/ERROR
  // by a direct sync call that bypasses the hidden-from-list UI.
  if (account.status === ConnectorStatus.REVOKED) {
    return NextResponse.json({ ok: false, error: "revoked" }, { status: 409 });
  }

  const helper = SYNC_HELPERS[account.provider as keyof typeof SYNC_HELPERS];

  if (!helper) {
    return NextResponse.json(
      {
        ok: false,
        error: "unsupported_provider",
        message: `Sync inline ainda não suportado para ${account.provider}.`,
      },
      { status: 400 },
    );
  }

  // Manual "Sync now" runs ONLY the foreground window (current UTC month →
  // today). It must return fast and never approach the 300s function limit —
  // a heavy store (e.g. iSET) whose foreground + a historical backfill batch
  // overran 300s was getting killed by the platform, surfacing as a raw HTTP
  // 500 to the user (no JSON body, generic chip). The heavy multi-year
  // historical backfill is owned by the background orchestrator
  // (runWorkspaceSync, triggered on page-visit/cron), which walks the cursor
  // backwards in fair time-sliced batches. Keeping the manual click
  // foreground-only makes it reliable while history still fills in the
  // background.
  const range = computeForegroundRange();
  const start = Date.now();
  // Generous headroom under the 300s limit: the deadline-bounded fetch returns
  // by here and leaves time for the daily-metric recompute that follows it.
  const deadline = start + 240_000;

  try {
    await helper({
      connectorAccountId: account.id,
      range,
      deadlineMs: deadline,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido ao sincronizar.";

    try {
      await prisma.connectorAccount.update({
        where: { id: account.id },
        data: {
          status: "ERROR",
          lastSyncError: message,
          lastSyncedAt: new Date(),
        },
      });
    } catch {
      // Defensive: ignore DB update failure so we still return a response.
    }

    await logAudit({
      action: "connector.manual.connect",
      userId: userContext.user.id,
      workspaceId: userContext.currentWorkspace.id,
      resourceType: "connector_account",
      resourceId: account.id,
      metadata: {
        manualSync: true,
        syncMode: "manual",
        provider: account.provider,
        ok: false,
        error: message,
      },
    });
    return NextResponse.json(
      { ok: false, error: "sync_failed", message },
      { status: 500 },
    );
  }

  const durationMs = Date.now() - start;

  // Advance the workspace sync marker so the open dashboard auto-refreshes.
  // DashboardAutoRefresh polls WorkspaceSyncState.lastSyncedAt and calls
  // router.refresh() when it moves; without this bump a manual per-connector
  // "Sincronizar agora" updated the DB but left the dashboard showing stale
  // numbers (diverging from the Marcas view, which renders fresh on navigation).
  try {
    await prisma.workspaceSyncState.upsert({
      where: { workspaceId: account.workspaceId },
      update: { lastSyncedAt: new Date() },
      create: { workspaceId: account.workspaceId, lastSyncedAt: new Date() },
    });
  } catch {
    // Non-fatal: the sync itself succeeded; the dashboard still refreshes on the
    // next background sync if this marker write fails transiently.
  }

  await logAudit({
    action: "connector.manual.connect",
    userId: userContext.user.id,
    workspaceId: userContext.currentWorkspace.id,
    resourceType: "connector_account",
    resourceId: account.id,
    metadata: {
      manualSync: true,
      syncMode: "manual",
      provider: account.provider,
      ok: true,
      durationMs,
    },
  });

  return NextResponse.json({ ok: true, durationMs });
}
