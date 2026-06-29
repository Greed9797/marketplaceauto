UPDATE "User"
SET "platformRole" = 'ADMIN_MASTER'
WHERE "platformRole" = 'W3_ADMIN';

CREATE OR REPLACE FUNCTION enforce_single_client_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = w3ads, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Membership" existing
    WHERE existing."userId" = NEW."userId"
      AND existing.id <> NEW.id
      AND (existing.role = 'CLIENT' OR NEW.role = 'CLIENT')
  ) THEN
    RAISE EXCEPTION 'CLIENT users can belong to only one workspace';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_client_workspace_trigger ON "Membership";
CREATE TRIGGER enforce_single_client_workspace_trigger
BEFORE INSERT OR UPDATE OF "userId", role, "workspaceId" ON "Membership"
FOR EACH ROW
EXECUTE FUNCTION enforce_single_client_workspace();

DROP POLICY IF EXISTS "membership_member_read" ON "Membership";
CREATE POLICY "membership_member_read" ON "Membership"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      "userId" = auth.uid()::text
      OR "workspaceId" IN (
        SELECT "workspaceId" FROM "Membership"
        WHERE "userId" = auth.uid()::text
          AND "role" IN ('OWNER', 'ADMIN', 'VIEWER')
      )
    )
  );

DROP POLICY IF EXISTS "connector_account_member_read" ON "ConnectorAccount";
CREATE POLICY "connector_account_member_read" ON "ConnectorAccount"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN', 'VIEWER')
    )
  );

DROP POLICY IF EXISTS "connector_provider_config_member_read" ON "ConnectorProviderConfig";
CREATE POLICY "connector_provider_config_member_read" ON "ConnectorProviderConfig"
  FOR SELECT
  USING (
    "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN', 'VIEWER')
    )
    OR EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = auth.uid()::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  );

DROP POLICY IF EXISTS "connector_provider_config_w3_admin_write" ON "ConnectorProviderConfig";
CREATE POLICY "connector_provider_config_w3_admin_write" ON "ConnectorProviderConfig"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = auth.uid()::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = auth.uid()::text
        AND "platformRole" IN ('ADMIN_MASTER', 'ADMIN_LIMITED', 'W3_ADMIN')
    )
  );

DROP POLICY IF EXISTS "sync_job_member_read" ON "SyncJob";
CREATE POLICY "sync_job_member_read" ON "SyncJob"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN', 'VIEWER')
    )
  );
