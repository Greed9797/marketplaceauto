-- Speeds up dashboard aggregator queries that filter by workspaceId + platform
-- + placedAt window (top products, category breakdown, state sales).
CREATE INDEX IF NOT EXISTS "EcommerceOrder_workspaceId_platform_placedAt_idx"
  ON "w3ads"."EcommerceOrder" ("workspaceId", "platform", "placedAt");
