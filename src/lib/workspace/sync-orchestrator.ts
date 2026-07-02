import { randomUUID } from "node:crypto";

import { ConnectorProvider, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

import { prisma } from "@/lib/db/prisma";
import { RETRYABLE_CONNECTOR_STATUSES } from "@/lib/connectors/sync-error";
import { SYNC_HELPERS } from "@/lib/connectors/sync-helpers";
import {
  backfillBatchMonthsFor,
  computeBackfillBatch,
  computeForegroundRange,
  computeIncrementalRange,
} from "@/lib/connectors/sync-range";

/**
 * Worst-case time to reserve for a single 3-month backfill batch per provider,
 * so the loop never starts a batch it can't finish before the deadline. Meta
 * /insights chunks 14-day windows and can run up to its own ~240s internal
 * deadline; e-commerce and Google are far lighter.
 */
function estimatedBatchMs(provider: ConnectorProvider): number {
  switch (provider) {
    case ConnectorProvider.META_ADS:
      return 240_000;
    case ConnectorProvider.GOOGLE_ADS:
    case ConnectorProvider.GA4:
      return 90_000;
    default:
      return 30_000;
  }
}

export const COOLDOWN_MS = 30 * 60 * 1000; // 30min on-login
export const BACKGROUND_THRESHOLD_MS = 90 * 60 * 1000; // 90min cron
export const LOCK_STALE_MS = 5 * 60 * 1000; // 5min — release stuck locks fast

export type TriggerOutcome = {
  triggered: boolean;
  reason:
    | "claimed"
    | "cooldown"
    | "locked"
    | "no_active_connectors"
    | "workspace_missing";
};

export type TriggerWorkspaceSyncInput = {
  workspaceId: string;
  triggeredBy: string;
  includeBackfill?: boolean;
  thresholdMs?: number;
  /**
   * Absolute wall-clock ceiling (epoch ms). A sync claimed late in a cron run
   * must not outlive the serverless function (300s) — past this instant the
   * sync stops claiming new batches and releases the lock normally.
   */
  deadlineAt?: number;
  /** Internal hook to keep tests deterministic — defaults to fire-and-forget `void`. */
  runner?: (
    workspaceId: string,
    triggeredBy: string,
    options: { includeBackfill: boolean; deadlineAt?: number },
  ) => Promise<void> | void;
};

/**
 * Attempts to claim a workspace sync slot via atomic compare-and-swap.
 * If claimed, dispatches `runWorkspaceSync` (fire-and-forget by default).
 *
 * Cooldown: skips when `lastSyncedAt` is newer than `thresholdMs` ago.
 * Lock: skips when another sync started < LOCK_STALE_MS ago.
 */
export async function triggerWorkspaceSyncIfStale(
  input: TriggerWorkspaceSyncInput,
): Promise<TriggerOutcome> {
  const thresholdMs = input.thresholdMs ?? COOLDOWN_MS;
  const includeBackfill = input.includeBackfill ?? true;
  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - thresholdMs);
  const lockCutoff = new Date(now.getTime() - LOCK_STALE_MS);

  console.info(
    `[sync-orchestrator] triggerWorkspaceSyncIfStale workspace=${input.workspaceId} triggeredBy=${input.triggeredBy} thresholdMs=${thresholdMs}`,
  );

  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return { triggered: false, reason: "workspace_missing" };
  }

  const activeCount = await prisma.connectorAccount.count({
    where: {
      workspaceId: input.workspaceId,
      status: { in: [...RETRYABLE_CONNECTOR_STATUSES] },
    },
  });
  if (activeCount === 0) {
    return { triggered: false, reason: "no_active_connectors" };
  }

  // Atomic insert-or-claim: single round-trip that creates the row on first
  // call and only claims when cooldown passed AND no fresh lock. The conditional
  // sits inside ON CONFLICT DO UPDATE, so two concurrent callers can never both
  // claim — Postgres serializes the row-level update.
  const claimId = randomUUID();
  const claimedRows = await prisma.$queryRaw<Array<{ workspaceId: string }>>(
    Prisma.sql`
      INSERT INTO "WorkspaceSyncState" (
        "id", "workspaceId", "lastSyncStartedAt", "lastSyncStatus",
        "triggeredBy", "syncCount", "updatedAt"
      )
      VALUES (
        ${claimId}, ${input.workspaceId}, ${now}, 'IN_PROGRESS',
        ${input.triggeredBy}, 0, ${now}
      )
      ON CONFLICT ("workspaceId") DO UPDATE
        SET "lastSyncStartedAt" = EXCLUDED."lastSyncStartedAt",
            "lastSyncStatus"    = EXCLUDED."lastSyncStatus",
            "triggeredBy"       = EXCLUDED."triggeredBy",
            "updatedAt"         = EXCLUDED."updatedAt"
        WHERE (
          "WorkspaceSyncState"."lastSyncedAt" IS NULL
          OR "WorkspaceSyncState"."lastSyncedAt" < ${cooldownCutoff}
        )
        AND (
          "WorkspaceSyncState"."lastSyncStartedAt" IS NULL
          OR "WorkspaceSyncState"."lastSyncStartedAt" < ${lockCutoff}
        )
      RETURNING "workspaceId"
    `,
  );

  if (claimedRows.length === 0) {
    const current = await prisma.workspaceSyncState.findUnique({
      where: { workspaceId: input.workspaceId },
      select: { lastSyncedAt: true, lastSyncStartedAt: true },
    });
    if (
      current?.lastSyncStartedAt &&
      current.lastSyncStartedAt.getTime() > lockCutoff.getTime()
    ) {
      return { triggered: false, reason: "locked" };
    }
    return { triggered: false, reason: "cooldown" };
  }

  const runner = input.runner ?? defaultRunner;

  try {
    await runner(input.workspaceId, input.triggeredBy, {
      includeBackfill,
      deadlineAt: input.deadlineAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(
      `[sync-orchestrator] runWorkspaceSync failed workspace=${input.workspaceId}: ${message}`,
    );
  }

  return { triggered: true, reason: "claimed" };
}

async function defaultRunner(
  workspaceId: string,
  _triggeredBy: string,
  options: { includeBackfill: boolean; deadlineAt?: number },
) {
  await runWorkspaceSync(workspaceId, options);
}

/**
 * Runs sync across every ACTIVE connector of the workspace.
 * Failures per-connector are recorded but do not abort the loop.
 * Always releases the lock and updates `lastSyncedAt` in the `finally` block.
 */
export async function runWorkspaceSync(
  workspaceId: string,
  options: { includeBackfill?: boolean; deadlineAt?: number } = {},
): Promise<void> {
  const includeBackfill = options.includeBackfill ?? true;
  let aggregateError: string | null = null;
  const startedAt = Date.now();

  console.info(`[sync-orchestrator] start workspace=${workspaceId}`);
  Sentry.addBreadcrumb({
    category: "sync",
    level: "info",
    message: "runWorkspaceSync start",
    data: { workspaceId },
  });

  try {
    const accounts = await prisma.connectorAccount.findMany({
      // ERROR connectors are retried too (see RETRYABLE_CONNECTOR_STATUSES): a
      // transient failure must not strand a connection until manual reconnect.
      where: {
        workspaceId,
        status: { in: [...RETRYABLE_CONNECTOR_STATUSES] },
      },
      select: {
        id: true,
        provider: true,
        historicalSyncedAt: true,
        historicalBackfillUntil: true,
        lastSyncedAt: true,
      },
    });

    const errors: string[] = [];
    // Hard wall-clock budget, kept ~30s under Vercel's 300s function limit so a
    // batch in flight never gets killed mid-write. A caller-supplied deadlineAt
    // (cron passing down its own remaining budget) tightens this further — a
    // sync claimed late in the cron run gets only what's left, never 270s.
    const hardDeadline = Math.min(
      Date.now() + 270_000,
      options.deadlineAt ?? Number.POSITIVE_INFINITY,
    );

    // Phase 1 — Foreground for every account first (current UTC month → today).
    // These are small/fast, so doing them all up front guarantees the dashboard
    // is current before the (slower) backfill consumes the rest of the budget.
    const syncable = accounts.filter((a) => SYNC_HELPERS[a.provider]);
    for (const account of syncable) {
      const helper = SYNC_HELPERS[account.provider]!;
      // NuvemShop syncs incrementally by updated_at (status=any) so late-paid
      // orders are re-fetched; other providers keep the created_at foreground
      // window (their clients don't support updated_at filtering).
      const range =
        account.provider === ConnectorProvider.NUVEMSHOP
          ? computeIncrementalRange({ lastSyncedAt: account.lastSyncedAt })
          : computeForegroundRange();
      try {
        await helper({
          connectorAccountId: account.id,
          range,
          // Bound heavy providers (iSET) so a big foreground window can't run
          // past the function limit and get killed (orphaned RUNNING job).
          deadlineMs: hardDeadline,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        errors.push(`${account.provider} foreground: ${message}`);
      }
    }

    // Phase 2 — Backfill, with a FAIR per-account time slice so one heavy Meta
    // account can't starve the others. Each account walks backwards in 3-month
    // slices; whatever is left resumes next trigger from the persisted cursor.
    if (includeBackfill) {
      const pending = syncable.filter(
        (a) => !(a.historicalSyncedAt && a.historicalBackfillUntil),
      );
      for (let i = 0; i < pending.length; i += 1) {
        const account = pending[i];
        const helper = SYNC_HELPERS[account.provider]!;
        const remainingAccounts = pending.length - i;
        const fairSlice = Math.floor(
          (hardDeadline - Date.now()) / remainingAccounts,
        );
        const accountDeadline = Math.min(
          hardDeadline,
          Date.now() + Math.max(fairSlice, 0),
        );
        // Provider-aware headroom: Meta /insights can run up to its own ~240s
        // internal deadline, so reserve that much; e-commerce/Google are far
        // lighter. We never start a batch we can't finish before the deadline.
        let maxBatchMs = estimatedBatchMs(account.provider);
        const batchMonths = backfillBatchMonthsFor(account.provider);
        let cursor = account.historicalBackfillUntil;
        try {
          while (Date.now() + maxBatchMs < accountDeadline) {
            const batch = computeBackfillBatch({
              historicalSyncedAt: account.historicalSyncedAt,
              historicalBackfillUntil: cursor,
              batchMonths,
            });
            if (!batch) {
              await prisma.connectorAccount.update({
                where: { id: account.id },
                data: { historicalSyncedAt: new Date() },
              });
              break;
            }
            const batchStart = Date.now();
            const result = await helper({
              connectorAccountId: account.id,
              range: batch,
              deadlineMs: accountDeadline,
            });
            maxBatchMs = Math.max(maxBatchMs, Date.now() - batchStart);
            // Heavy provider (iSET) can report the window cut short by the time
            // budget. Do NOT advance the cursor then — the unfetched remainder
            // (tracked by the per-window offset map) must resume next trigger,
            // not be skipped. We're out of budget anyway, so stop.
            if ("complete" in result && result.complete === false) {
              break;
            }
            cursor = new Date(batch.since);
            await prisma.connectorAccount.update({
              where: { id: account.id },
              data: { historicalBackfillUntil: cursor },
            });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "unknown";
          errors.push(`${account.provider} backfill: ${message}`);
        }
      }
    }

    if (errors.length > 0) {
      aggregateError = errors.join(" | ").slice(0, 1000);
    }
  } catch (err: unknown) {
    aggregateError = err instanceof Error ? err.message : "unknown";
    Sentry.captureException(err, {
      tags: { module: "sync-orchestrator", workspaceId },
    });
  } finally {
    // Guard the lock-release write: if this throws (pool exhaustion, transient
    // DB error) the exception must NOT propagate, or `lastSyncStartedAt` stays
    // set and the workspace is locked until the 5-min stale TTL. Surface it to
    // Sentry; the TTL still provides eventual recovery.
    try {
      await prisma.workspaceSyncState.update({
        where: { workspaceId },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStartedAt: null,
          lastSyncStatus: aggregateError ? "FAILED" : "SUCCESS",
          lastSyncError: aggregateError,
          syncCount: { increment: 1 },
        },
      });
    } catch (releaseErr: unknown) {
      console.error(
        `[sync-orchestrator] lock-release failed workspace=${workspaceId}: ${
          releaseErr instanceof Error ? releaseErr.message : "unknown"
        }`,
      );
      Sentry.captureException(releaseErr, {
        tags: { module: "sync-lock-release", workspaceId },
      });
    }
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

    console.info(
      `[sync-orchestrator] done workspace=${workspaceId} elapsed=${elapsedSec}s status=${
        aggregateError ? "FAILED" : "SUCCESS"
      }`,
    );
    Sentry.addBreadcrumb({
      category: "sync",
      level: aggregateError ? "error" : "info",
      message: "runWorkspaceSync done",
      data: {
        workspaceId,
        elapsedSec,
        status: aggregateError ? "FAILED" : "SUCCESS",
      },
    });
  }
}
