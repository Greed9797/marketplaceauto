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
