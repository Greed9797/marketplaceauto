-- WorkspaceSyncState: per-workspace lastSyncedAt + lock for SWR sync orchestrator
CREATE TABLE IF NOT EXISTS "WorkspaceSyncState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSyncState_workspaceId_key" ON "WorkspaceSyncState"("workspaceId");
CREATE INDEX IF NOT EXISTS "WorkspaceSyncState_lastSyncedAt_idx" ON "WorkspaceSyncState"("lastSyncedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceSyncState_workspaceId_fkey'
    ) THEN
        ALTER TABLE "WorkspaceSyncState"
            ADD CONSTRAINT "WorkspaceSyncState_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
