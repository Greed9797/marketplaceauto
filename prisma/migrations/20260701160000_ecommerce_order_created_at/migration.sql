-- NuvemShop revenue reconciliation: bucket revenue by the order's CREATION date
-- (source platform order.created_at), matching the store's own revenue report,
-- instead of paid_at (placedAt). Nullable + backward-compatible: existing rows
-- stay NULL until re-backfilled; the aggregator falls back to placedAt while NULL.
ALTER TABLE "EcommerceOrder"
  ADD COLUMN IF NOT EXISTS "orderCreatedAt" TIMESTAMP(3);

-- Speeds up the dashboard revenue query that now filters by
-- workspaceId + platform + orderCreatedAt window.
CREATE INDEX IF NOT EXISTS "EcommerceOrder_workspaceId_platform_orderCreatedAt_idx"
  ON "EcommerceOrder" ("workspaceId", "platform", "orderCreatedAt");
