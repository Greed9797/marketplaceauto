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
