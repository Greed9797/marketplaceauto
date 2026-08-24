import { NextResponse, type NextRequest } from "next/server";

import { RETRYABLE_CONNECTOR_STATUSES } from "@/lib/connectors/sync-error";
import {
  KEEPALIVE_PROVIDERS,
  KEEPALIVE_SKEW_MS,
  keepAliveRefreshConnector,
  type KeepAliveResult,
} from "@/lib/connectors/token-refresh";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Bound the per-run work so one cron invocation can't exceed maxDuration.
const BATCH_SIZE = 200;

/**
 * Keeps marketplace OAuth tokens warm. Refreshes ACTIVE Mercado Livre / Shopee
 * connectors whose access token is within KEEPALIVE_SKEW_MS of expiry, so the
 * rotating refresh token is exercised often enough that the provider never
 * expires it for inactivity — independent of whether the (heavier) order sync
 * reached that connector. Auth-fatal failures flip the connector to
 * TOKEN_EXPIRED; transient ones leave it ACTIVE for the next run.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const dueBefore = new Date(Date.now() + KEEPALIVE_SKEW_MS);
  const connectors = await prisma.connectorAccount.findMany({
    where: {
      // ERROR is retryable (transient failures keep the grant alive) — keep the
      // token warm so the retried sync can succeed instead of dying on expiry.
      status: { in: [...RETRYABLE_CONNECTOR_STATUSES] },
      provider: { in: [...KEEPALIVE_PROVIDERS] },
      tokenExpiresAt: { not: null, lte: dueBefore },
    },
    orderBy: { tokenExpiresAt: "asc" },
    take: BATCH_SIZE,
  });

  const tally: Record<KeepAliveResult, number> = {
    refreshed: 0,
    skipped: 0,
    token_expired: 0,
    transient_error: 0,
    unsupported: 0,
  };

  // Leave headroom before maxDuration so a slow provider can't get the whole
  // invocation killed mid-batch; unprocessed connectors wait for the next run.
  const deadline = Date.now() + 270_000;

  for (const connector of connectors) {
    if (Date.now() > deadline) break;
    try {
      tally[await keepAliveRefreshConnector(connector)] += 1;
    } catch (error: unknown) {
      // keepAliveRefreshConnector already persists status on failure; this guard
      // just keeps one bad connector from aborting the whole batch.
      const message = error instanceof Error ? error.message : "unknown";
      console.error(
        `[cron/token-keepalive] connector=${connector.id} failed: ${message}`,
      );
      tally.transient_error += 1;
    }
  }

  // Retenção: SyncJob cresce um registro por conector por sync e ninguém lê
  // histórico antigo; sem poda vira dezenas de milhares de linhas por ano.
  const [syncJobsDeleted, auditLogsDeleted] = await Promise.all([
    prisma.syncJob.deleteMany({
      where: { startedAt: { lt: new Date(Date.now() - 180 * 86_400_000) } },
    }),
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 730 * 86_400_000) } },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    processed: connectors.length,
    ...tally,
    retention: { syncJobsDeleted: syncJobsDeleted.count, auditLogsDeleted: auditLogsDeleted.count },
  });
}
