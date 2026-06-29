SET search_path = w3ads, public;

-- Keep auth-adjacent tables private from Supabase Data API roles.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "User" FROM anon;
REVOKE ALL ON "Account", "Session", "VerificationToken", "PasswordResetToken" FROM anon, authenticated;
GRANT SELECT ON "User" TO authenticated;
GRANT ALL ON "User", "Account", "Session", "VerificationToken", "PasswordResetToken" TO service_role;

DROP POLICY IF EXISTS "user_self_read" ON "User";
CREATE POLICY "user_self_read" ON "User"
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) IS NOT NULL
    AND "id" = (select auth.uid())::text
  );

-- Provider configuration contains secret references and must be internal-only.
DROP POLICY IF EXISTS "connector_provider_config_member_read" ON "ConnectorProviderConfig";
DROP POLICY IF EXISTS "connector_provider_config_internal_read" ON "ConnectorProviderConfig";
CREATE POLICY "connector_provider_config_internal_read" ON "ConnectorProviderConfig"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "User"
      WHERE "id" = (select auth.uid())::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  );

DROP POLICY IF EXISTS "connector_provider_config_w3_admin_write" ON "ConnectorProviderConfig";
CREATE POLICY "connector_provider_config_w3_admin_write" ON "ConnectorProviderConfig"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "User"
      WHERE "id" = (select auth.uid())::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "User"
      WHERE "id" = (select auth.uid())::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  );

-- OAuth account-selection sessions are temporary and should not be readable
-- by regular workspace viewers/clients.
DROP POLICY IF EXISTS "workspace_member_read_connector_selection_session" ON "ConnectorSelectionSession";
DROP POLICY IF EXISTS "workspace_admin_write_connector_selection_session" ON "ConnectorSelectionSession";
DROP POLICY IF EXISTS "connector_selection_session_owner_read" ON "ConnectorSelectionSession";
DROP POLICY IF EXISTS "connector_selection_session_admin_write" ON "ConnectorSelectionSession";

CREATE POLICY "connector_selection_session_owner_read" ON "ConnectorSelectionSession"
  FOR SELECT
  TO authenticated
  USING (
    "userId" = (select auth.uid())::text
    AND (
      "workspaceId" IN (
        SELECT "workspaceId"
        FROM "Membership"
        WHERE "userId" = (select auth.uid())::text
          AND "role" IN ('OWNER', 'ADMIN')
      )
      OR EXISTS (
        SELECT 1
        FROM "User"
        WHERE "id" = (select auth.uid())::text
          AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
      )
    )
  );

CREATE POLICY "connector_selection_session_admin_write" ON "ConnectorSelectionSession"
  FOR ALL
  TO authenticated
  USING (
    "workspaceId" IN (
      SELECT "workspaceId"
      FROM "Membership"
      WHERE "userId" = (select auth.uid())::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
    OR EXISTS (
      SELECT 1
      FROM "User"
      WHERE "id" = (select auth.uid())::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  )
  WITH CHECK (
    "userId" = (select auth.uid())::text
    AND (
      "workspaceId" IN (
        SELECT "workspaceId"
        FROM "Membership"
        WHERE "userId" = (select auth.uid())::text
          AND "role" IN ('OWNER', 'ADMIN')
      )
      OR EXISTS (
        SELECT 1
        FROM "User"
        WHERE "id" = (select auth.uid())::text
          AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
      )
    )
  );

-- Normalize missing relational protection on fact tables. NOT VALID avoids
-- blocking migration on legacy orphan rows; validate after remote data cleanup.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyMetric_connectorAccountId_fkey'
  ) THEN
    ALTER TABLE "DailyMetric"
      ADD CONSTRAINT "DailyMetric_connectorAccountId_fkey"
      FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EcommerceOrder_workspaceId_fkey'
  ) THEN
    ALTER TABLE "EcommerceOrder"
      ADD CONSTRAINT "EcommerceOrder_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EcommerceOrder_connectorAccountId_fkey'
  ) THEN
    ALTER TABLE "EcommerceOrder"
      ADD CONSTRAINT "EcommerceOrder_connectorAccountId_fkey"
      FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EcommerceOrderItem_workspaceId_fkey'
  ) THEN
    ALTER TABLE "EcommerceOrderItem"
      ADD CONSTRAINT "EcommerceOrderItem_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EcommerceOrderItem_connectorAccountId_fkey'
  ) THEN
    ALTER TABLE "EcommerceOrderItem"
      ADD CONSTRAINT "EcommerceOrderItem_connectorAccountId_fkey"
      FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SyncJob_workspaceId_fkey'
  ) THEN
    ALTER TABLE "SyncJob"
      ADD CONSTRAINT "SyncJob_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SyncJob_connectorAccountId_fkey'
  ) THEN
    ALTER TABLE "SyncJob"
      ADD CONSTRAINT "SyncJob_connectorAccountId_fkey"
      FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
