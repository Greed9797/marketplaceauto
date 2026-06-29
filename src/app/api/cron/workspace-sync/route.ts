import { NextResponse, type NextRequest } from "next/server";
import { ConnectorStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  BACKGROUND_THRESHOLD_MS,
  triggerWorkspaceSyncIfStale,
} from "@/lib/workspace/sync-orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const cutoff = new Date(Date.now() - BACKGROUND_THRESHOLD_MS);
  // Severe staleness: 2× the background threshold. Anything older than this that
  // the per-run BATCH_SIZE can't reach is a coverage gap we must surface.
  const severeCutoff = new Date(Date.now() - 2 * BACKGROUND_THRESHOLD_MS);

  const staleWhere: Prisma.WorkspaceWhereInput = {
    connectors: { some: { status: ConnectorStatus.ACTIVE } },
    OR: [
      { syncState: null },
      { syncState: { lastSyncedAt: { lt: cutoff } } },
      { syncState: { lastSyncedAt: null } },
    ],
  };

  // Oldest-synced (and never-synced) first, so when the backlog exceeds
  // BATCH_SIZE the most-stale workspaces always get priority and the tail can't
  // be starved forever.
  const stale = await prisma.workspace.findMany({
    where: staleWhere,
    select: { id: true },
    orderBy: { syncState: { lastSyncedAt: { sort: "asc", nulls: "first" } } },
    take: BATCH_SIZE,
  });

  // Coverage metric: total stale vs what this run can cover, plus severely
  // stale (>2× threshold). A non-zero backlog is the signal for an external
  // scheduler / more frequent cron (see docs/ops/manual-setup.md).
  const [staleTotal, severeBacklog] = await Promise.all([
    prisma.workspace.count({ where: staleWhere }),
    prisma.workspace.count({
      where: {
        connectors: { some: { status: ConnectorStatus.ACTIVE } },
        OR: [
          { syncState: null },
          { syncState: { lastSyncedAt: { lt: severeCutoff } } },
          { syncState: { lastSyncedAt: null } },
        ],
      },
    }),
  ]);
  const backlog = Math.max(0, staleTotal - stale.length);
  if (backlog > 0 || severeBacklog > 0) {
    const message = `[cron/workspace-sync] coverage gap: staleTotal=${staleTotal} covered=${stale.length} backlog=${backlog} severe=${severeBacklog}`;
    if (severeBacklog > 0) {
      // >2× the stale threshold means workspaces are starving on the daily slot.
      // Escalate to error level so Sentry surfaces it as an actionable signal to
      // deploy the 30-min external scheduler (see docs/ops/manual-setup.md).
      console.error(message);
    } else {
      console.warn(message);
    }
  }

  // Process workspaces with bounded concurrency instead of strictly serial:
  // runWorkspaceSync runs inline (up to ~270s each), so a serial loop would let
  // the FIRST heavy workspace eat the whole 300s budget and silently starve the
  // rest. A small pool utilizes the budget across several workspaces while the
  // outer deadline stops claiming new work before the function is killed. The
  // atomic INSERT…ON CONFLICT claim is safe under concurrent callers.
  const startedAtMs = Date.now();
  const OUTER_DEADLINE = startedAtMs + 250_000;
  // Ceiling handed down to each claimed sync: a workspace claimed at 249s must
  // not run its full 270s inner budget (that would blow past maxDuration=300 and
  // get the function killed mid-write, leaving the advisory lock set for
  // LOCK_STALE_MS). The sync trims itself to whatever remains.
  const SYNC_DEADLINE_AT = startedAtMs + 290_000;
  const CONCURRENCY = 5;
  const outcomes: Array<{ workspaceId: string; outcome: string }> = [];
  const queue = [...stale];

  async function worker() {
    while (queue.length > 0 && Date.now() < OUTER_DEADLINE) {
      const workspace = queue.shift();
      if (!workspace) break;
      // One workspace's DB hiccup must not reject the whole Promise.all and
      // abandon every queued sibling until the next cron cycle.
      try {
        const result = await triggerWorkspaceSyncIfStale({
          workspaceId: workspace.id,
          triggeredBy: "cron",
          thresholdMs: BACKGROUND_THRESHOLD_MS,
          deadlineAt: SYNC_DEADLINE_AT,
        });
        outcomes.push({
          workspaceId: workspace.id,
          outcome: `${result.triggered ? "triggered" : "skipped"}:${result.reason}`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        console.error(
          `[cron/workspace-sync] workspace=${workspace.id} failed: ${message}`,
        );
        outcomes.push({
          workspaceId: workspace.id,
          outcome: `error:${message.slice(0, 120)}`,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, stale.length) }, () => worker()),
  );
  const notReached = queue.length;

  return NextResponse.json({
    ok: true,
    candidates: stale.length,
    notReached,
    backlog,
    severeBacklog,
    outcomes,
  });
}
