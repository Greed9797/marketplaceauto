-- Migrations 20260528160000 / 20260612100000 hardcoded the "w3ads" schema, so
-- deployments running under another schema (?schema=w3marketplace) recorded
-- them as applied without actually creating the indexes there. Recreate them
-- unqualified (resolved via the connection's search_path). IF NOT EXISTS keeps
-- this a no-op on the original w3ads deployment.
CREATE INDEX IF NOT EXISTS "EcommerceOrder_workspaceId_platform_placedAt_idx"
  ON "EcommerceOrder" ("workspaceId", "platform", "placedAt");

CREATE INDEX IF NOT EXISTS "EcommerceOrderItem_ecommerceOrderId_idx"
  ON "EcommerceOrderItem" ("ecommerceOrderId");
