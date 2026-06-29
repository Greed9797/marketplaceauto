SET search_path = w3ads, public, extensions;

ALTER TABLE "EcommerceOrder"
  ADD COLUMN IF NOT EXISTS "shippingState" TEXT;

CREATE TABLE IF NOT EXISTS "EcommerceOrderItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "connectorAccountId" TEXT NOT NULL,
  "ecommerceOrderId" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "sku" TEXT,
  "quantity" INTEGER NOT NULL,
  "total" DECIMAL(14, 2),
  "placedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EcommerceOrderItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EcommerceOrderItem"
  DROP CONSTRAINT IF EXISTS "EcommerceOrderItem_ecommerceOrderId_fkey";

ALTER TABLE "EcommerceOrderItem"
  ADD CONSTRAINT "EcommerceOrderItem_ecommerceOrderId_fkey"
  FOREIGN KEY ("ecommerceOrderId") REFERENCES "EcommerceOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "EcommerceOrderItem_workspaceId_placedAt_idx"
  ON "EcommerceOrderItem"("workspaceId", "placedAt");

CREATE INDEX IF NOT EXISTS "EcommerceOrderItem_connectorAccountId_externalOrderId_idx"
  ON "EcommerceOrderItem"("connectorAccountId", "externalOrderId");

ALTER TABLE "EcommerceOrderItem" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "EcommerceOrderItem" TO authenticated;
GRANT ALL ON "EcommerceOrderItem" TO service_role;

DROP POLICY IF EXISTS "ecommerce_order_item_member_read" ON "EcommerceOrderItem";
DROP POLICY IF EXISTS "workspace_member_read" ON "EcommerceOrderItem";
CREATE POLICY "ecommerce_order_item_member_read" ON "EcommerceOrderItem"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "ecommerce_order_item_admin_write" ON "EcommerceOrderItem";
DROP POLICY IF EXISTS "workspace_admin_write" ON "EcommerceOrderItem";
CREATE POLICY "ecommerce_order_item_admin_write" ON "EcommerceOrderItem"
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

UPDATE "User"
SET "platformRole" = 'ADMIN_MASTER'
WHERE "platformRole" = 'W3_ADMIN';

CREATE OR REPLACE FUNCTION w3ads.enforce_single_client_workspace()
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
EXECUTE FUNCTION w3ads.enforce_single_client_workspace();

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

NOTIFY pgrst, 'reload schema';
