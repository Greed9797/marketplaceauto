SET search_path = w3ads, public, extensions;

ALTER TABLE IF EXISTS "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "SyncJob" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_read" ON "User";
CREATE POLICY "user_own_read" ON "User"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "id" = auth.uid()::text
  );

DROP POLICY IF EXISTS "user_own_update" ON "User";
CREATE POLICY "user_own_update" ON "User"
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND "id" = auth.uid()::text
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "id" = auth.uid()::text
  );

DROP POLICY IF EXISTS "account_own_read" ON "Account";
CREATE POLICY "account_own_read" ON "Account"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
  );

DROP POLICY IF EXISTS "session_own_read" ON "Session";
CREATE POLICY "session_own_read" ON "Session"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
  );

DROP POLICY IF EXISTS "password_reset_own_read" ON "PasswordResetToken";
CREATE POLICY "password_reset_own_read" ON "PasswordResetToken"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
  );

DROP POLICY IF EXISTS "sync_job_member_read" ON "SyncJob";
CREATE POLICY "sync_job_member_read" ON "SyncJob"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "sync_job_admin_write" ON "SyncJob";
CREATE POLICY "sync_job_admin_write" ON "SyncJob"
  FOR ALL
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

-- No policy for VerificationToken: this is an internal Auth.js token table and
-- should stay inaccessible through PostgREST to anon/authenticated clients.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA w3ads TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA w3ads TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA w3ads TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
