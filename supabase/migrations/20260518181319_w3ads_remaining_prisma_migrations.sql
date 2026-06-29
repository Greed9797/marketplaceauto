SET search_path = w3ads, public, extensions;


-- Source: prisma/migrations/20260517000000_lgpd_soft_delete/migration.sql
-- Add soft-delete marker used by the LGPD account deletion request flow.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Source: prisma/migrations/20260517001000_beta_feedback/migration.sql
CREATE TYPE "BetaFeedbackType" AS ENUM ('BUG', 'SUGGESTION', 'QUESTION');

CREATE TYPE "BetaFeedbackStatus" AS ENUM ('OPEN', 'REVIEWED', 'CLOSED');

CREATE TABLE "BetaFeedback" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "userId" TEXT,
  "type" "BetaFeedbackType" NOT NULL DEFAULT 'SUGGESTION',
  "message" TEXT NOT NULL,
  "pagePath" TEXT,
  "status" "BetaFeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetaFeedback_workspaceId_createdAt_idx" ON "BetaFeedback"("workspaceId", "createdAt");
CREATE INDEX "BetaFeedback_userId_createdAt_idx" ON "BetaFeedback"("userId", "createdAt");
CREATE INDEX "BetaFeedback_status_createdAt_idx" ON "BetaFeedback"("status", "createdAt");

ALTER TABLE "BetaFeedback"
  ADD CONSTRAINT "BetaFeedback_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BetaFeedback"
  ADD CONSTRAINT "BetaFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BetaFeedback" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "beta_feedback_admin_read" ON "BetaFeedback"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY "beta_feedback_member_insert" ON "BetaFeedback"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
    )
  );

CREATE POLICY "beta_feedback_admin_update" ON "BetaFeedback"
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

-- Source: prisma/migrations/20260518103000_expanded_connector_providers/migration.sql
-- Expanded connector support for W3ADS marketplace and ecommerce providers.

ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'NUVEMSHOP';
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'ISET';
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'TRAY';
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'WBUY';
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'MAGAZORD';

CREATE TABLE IF NOT EXISTS "ConnectorSelectionSession" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "ConnectorProvider" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "accounts" JSONB NOT NULL,
  "credentialCiphertext" TEXT NOT NULL,
  "credentialIv" TEXT NOT NULL,
  "credentialAuthTag" TEXT NOT NULL,
  "credentialKeyVersion" TEXT NOT NULL DEFAULT 'v1',
  "credentialSecretId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConnectorSelectionSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConnectorSelectionSession_workspaceId_userId_provider_idx"
  ON "ConnectorSelectionSession"("workspaceId", "userId", "provider");

CREATE INDEX IF NOT EXISTS "ConnectorSelectionSession_expiresAt_idx"
  ON "ConnectorSelectionSession"("expiresAt");

ALTER TABLE "ConnectorSelectionSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_member_read_connector_selection_session" ON "ConnectorSelectionSession"
  FOR SELECT
  USING (
    "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
    )
  );

CREATE POLICY "workspace_admin_write_connector_selection_session" ON "ConnectorSelectionSession"
  FOR ALL
  USING (
    "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  )
  WITH CHECK (
    "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

-- Source: prisma/migrations/20260518112000_connector_provider_config_vault/migration.sql
-- Provider configuration moves OAuth/API app credentials from env vars to workspace-scoped app CRUD.
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'W3_ADMIN');
CREATE TYPE "ConnectorProviderConfigStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

ALTER TABLE "ConnectorAccount"
  ADD COLUMN IF NOT EXISTS "credentialSecretId" TEXT,
  ADD COLUMN IF NOT EXISTS "refreshCredentialSecretId" TEXT;

ALTER TABLE "ConnectorSelectionSession"
  ADD COLUMN IF NOT EXISTS "credentialSecretId" TEXT;

CREATE TABLE IF NOT EXISTS "ConnectorProviderConfig" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" "ConnectorProvider" NOT NULL,
  "status" "ConnectorProviderConfigStatus" NOT NULL DEFAULT 'ACTIVE',
  "redirectUri" TEXT,
  "scopes" TEXT,
  "apiVersion" TEXT,
  "baseUrl" TEXT,
  "ordersPath" TEXT,
  "displayName" TEXT,
  "publicCredentials" JSONB,
  "secretRefs" JSONB,
  "lastValidatedAt" TIMESTAMP(3),
  "lastValidationError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectorProviderConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorProviderConfig_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorProviderConfig_workspaceId_provider_key"
  ON "ConnectorProviderConfig"("workspaceId", "provider");

CREATE INDEX IF NOT EXISTS "ConnectorProviderConfig_workspaceId_status_idx"
  ON "ConnectorProviderConfig"("workspaceId", "status");

ALTER TABLE "ConnectorProviderConfig" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connector_provider_config_member_read" ON "ConnectorProviderConfig"
  FOR SELECT
  USING (
    "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = auth.uid()::text
        AND "platformRole" = 'W3_ADMIN'
    )
  );

CREATE POLICY "connector_provider_config_w3_admin_write" ON "ConnectorProviderConfig"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = auth.uid()::text
        AND "platformRole" = 'W3_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = auth.uid()::text
        AND "platformRole" = 'W3_ADMIN'
    )
  );

-- Source: prisma/migrations/20260518123000_adstart_workspace_role_flow/migration.sql
-- Adstart-style account model:
-- users belong to workspaces through memberships, and workspace data/tokens stay on the workspace.
-- Keep RLS aligned with the app-level role contract.

DROP POLICY IF EXISTS "workspace_owner_update" ON "Workspace";

CREATE POLICY "workspace_owner_update" ON "Workspace"
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND "id" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" = 'OWNER'
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "id" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" = 'OWNER'
    )
  );

DROP POLICY IF EXISTS "membership_admin_write" ON "Membership";
DROP POLICY IF EXISTS "membership_admin_insert" ON "Membership";
DROP POLICY IF EXISTS "membership_admin_update_non_owner" ON "Membership";
DROP POLICY IF EXISTS "membership_admin_delete_non_owner" ON "Membership";

CREATE POLICY "membership_admin_insert" ON "Membership"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "role" IN ('ADMIN', 'VIEWER')
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY "membership_admin_update_non_owner" ON "Membership"
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND "role" <> 'OWNER'
    AND "userId" <> auth.uid()::text
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "role" IN ('ADMIN', 'VIEWER')
    AND "userId" <> auth.uid()::text
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY "membership_admin_delete_non_owner" ON "Membership"
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND "role" <> 'OWNER'
    AND "userId" <> auth.uid()::text
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

-- Source: prisma/migrations/20260518160000_syncjob_operational_tracking/migration.sql
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

NOTIFY pgrst, 'reload schema';
