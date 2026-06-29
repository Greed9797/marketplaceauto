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
