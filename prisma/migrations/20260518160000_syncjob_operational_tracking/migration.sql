CREATE TYPE "SyncType" AS ENUM ('BACKFILL', 'INCREMENTAL', 'TOKEN_REFRESH', 'MANUAL');

ALTER TABLE "SyncJob"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "provider" "ConnectorProvider",
  ADD COLUMN "syncType" "SyncType" NOT NULL DEFAULT 'BACKFILL',
  ADD COLUMN "cursor" TEXT;

UPDATE "SyncJob"
SET
  "workspaceId" = "ConnectorAccount"."workspaceId",
  "provider" = "ConnectorAccount"."provider"
FROM "ConnectorAccount"
WHERE "SyncJob"."connectorAccountId" = "ConnectorAccount"."id";

DELETE FROM "SyncJob"
WHERE "workspaceId" IS NULL
   OR "provider" IS NULL;

ALTER TABLE "SyncJob"
  ALTER COLUMN "workspaceId" SET NOT NULL,
  ALTER COLUMN "provider" SET NOT NULL;

ALTER TABLE "SyncJob"
  ADD CONSTRAINT "SyncJob_connectorAccountId_fkey"
  FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncJob"
  ADD CONSTRAINT "SyncJob_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SyncJob_workspaceId_provider_status_startedAt_idx"
  ON "SyncJob"("workspaceId", "provider", "status", "startedAt");
