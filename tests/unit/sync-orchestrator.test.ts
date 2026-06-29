import { ConnectorStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMocks } = vi.hoisted(() => ({
  prismaMocks: {
    workspace: { findUnique: vi.fn() },
    connectorAccount: { count: vi.fn(), findMany: vi.fn() },
    workspaceSyncState: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: prismaMocks,
}));

vi.mock("@/lib/connectors/sync-helpers", () => ({
  SYNC_HELPERS: {},
  isoDaysAgo: (n: number) => `iso-${n}d`,
  todayIso: () => "iso-today",
}));

import {
  BACKGROUND_THRESHOLD_MS,
  COOLDOWN_MS,
  LOCK_STALE_MS,
  runWorkspaceSync,
  triggerWorkspaceSyncIfStale,
} from "@/lib/workspace/sync-orchestrator";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.workspace.findUnique.mockResolvedValue({ id: "ws-1" });
  prismaMocks.connectorAccount.count.mockResolvedValue(2);
  prismaMocks.workspaceSyncState.upsert.mockResolvedValue({});
  prismaMocks.workspaceSyncState.update.mockResolvedValue({});
  prismaMocks.workspaceSyncState.findUnique.mockResolvedValue(null);
  prismaMocks.$queryRaw.mockResolvedValue([]);
});

describe("triggerWorkspaceSyncIfStale", () => {
  it("returns workspace_missing when workspace does not exist", async () => {
    prismaMocks.workspace.findUnique.mockResolvedValueOnce(null);
    const runner = vi.fn();

    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-missing",
      triggeredBy: "test",
      runner,
    });

    expect(result).toEqual({ triggered: false, reason: "workspace_missing" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips when workspace has no ACTIVE connectors", async () => {
    prismaMocks.connectorAccount.count.mockResolvedValueOnce(0);
    const runner = vi.fn();

    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "test",
      runner,
    });

    expect(result).toEqual({
      triggered: false,
      reason: "no_active_connectors",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("claims and triggers runner when cooldown expired and no lock", async () => {
    prismaMocks.$queryRaw.mockResolvedValueOnce([{ workspaceId: "ws-1" }]);
    const runner = vi.fn().mockResolvedValue(undefined);

    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "login:user-1",
      runner,
    });

    expect(result).toEqual({ triggered: true, reason: "claimed" });
    // Allow fire-and-forget microtask to flush.
    await new Promise((resolve) => setImmediate(resolve));
    expect(runner).toHaveBeenCalledWith("ws-1", "login:user-1", {
      includeBackfill: true,
    });
  });

  it("passes includeBackfill=false to runner for foreground-only callers", async () => {
    prismaMocks.$queryRaw.mockResolvedValueOnce([{ workspaceId: "ws-1" }]);
    const runner = vi.fn().mockResolvedValue(undefined);

    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "login:user-1",
      includeBackfill: false,
      runner,
    });

    expect(result).toEqual({ triggered: true, reason: "claimed" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runner).toHaveBeenCalledWith("ws-1", "login:user-1", {
      includeBackfill: false,
    });
  });

  it("reports cooldown when claim fails and lock is not active", async () => {
    prismaMocks.$queryRaw.mockResolvedValueOnce([]);
    prismaMocks.workspaceSyncState.findUnique.mockResolvedValueOnce({
      lastSyncedAt: new Date(),
      lastSyncStartedAt: null,
    });
    const runner = vi.fn();

    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "login:user-1",
      runner,
    });

    expect(result).toEqual({ triggered: false, reason: "cooldown" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports locked when claim fails because of fresh lock", async () => {
    prismaMocks.$queryRaw.mockResolvedValueOnce([]);
    prismaMocks.workspaceSyncState.findUnique.mockResolvedValueOnce({
      lastSyncedAt: null,
      lastSyncStartedAt: new Date(Date.now() - 1000), // fresh
    });
    const runner = vi.fn();

    const result = await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "cron",
      runner,
    });

    expect(result).toEqual({ triggered: false, reason: "locked" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("passes correct threshold for cron (90min) vs login default (30min)", async () => {
    prismaMocks.$queryRaw.mockResolvedValue([{ workspaceId: "ws-1" }]);
    const runner = vi.fn().mockResolvedValue(undefined);

    await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "login:user-1",
      runner,
    });
    // Prisma.sql tagged template captures interpolated values in `.values`.
    // The cooldown cutoff is interpolated after workspaceId/now/triggeredBy/
    // now/now (5 prior bindings), so it lands at index 5.
    const loginValues = (
      prismaMocks.$queryRaw.mock.calls[0][0] as unknown as { values: unknown[] }
    ).values;
    const loginCutoff = loginValues[5] as Date;

    await triggerWorkspaceSyncIfStale({
      workspaceId: "ws-1",
      triggeredBy: "cron",
      thresholdMs: BACKGROUND_THRESHOLD_MS,
      runner,
    });
    const cronValues = (
      prismaMocks.$queryRaw.mock.calls[1][0] as unknown as { values: unknown[] }
    ).values;
    const cronCutoff = cronValues[5] as Date;

    // login cutoff is more recent (less ago) than cron cutoff
    expect(loginCutoff.getTime()).toBeGreaterThan(cronCutoff.getTime());
    const diff = loginCutoff.getTime() - cronCutoff.getTime();
    // approx 60min difference
    expect(diff).toBeGreaterThan(50 * 60 * 1000);
    expect(diff).toBeLessThan(70 * 60 * 1000);
  });

  it("constants reflect business rules", () => {
    expect(COOLDOWN_MS).toBe(30 * 60 * 1000);
    expect(BACKGROUND_THRESHOLD_MS).toBe(90 * 60 * 1000);
    expect(LOCK_STALE_MS).toBe(5 * 60 * 1000);
  });
});

describe("runWorkspaceSync", () => {
  it("always releases the lock and updates lastSyncedAt", async () => {
    prismaMocks.connectorAccount.findMany.mockResolvedValueOnce([]);

    await runWorkspaceSync("ws-1");

    expect(prismaMocks.workspaceSyncState.update).toHaveBeenCalledTimes(1);
    const updateArgs = prismaMocks.workspaceSyncState.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ workspaceId: "ws-1" });
    expect(updateArgs.data.lastSyncStartedAt).toBeNull();
    expect(updateArgs.data.lastSyncStatus).toBe("SUCCESS");
    expect(updateArgs.data.lastSyncedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.syncCount).toEqual({ increment: 1 });
  });

  it("filters to ACTIVE connectors only and loads historicalSyncedAt", async () => {
    prismaMocks.connectorAccount.findMany.mockResolvedValueOnce([]);

    await runWorkspaceSync("ws-1");

    expect(prismaMocks.connectorAccount.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", status: ConnectorStatus.ACTIVE },
      select: {
        id: true,
        provider: true,
        historicalSyncedAt: true,
        historicalBackfillUntil: true,
      },
    });
  });
});
