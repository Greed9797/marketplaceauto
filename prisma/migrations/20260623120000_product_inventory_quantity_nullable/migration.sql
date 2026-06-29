-- Stock can be "untracked / unlimited" (store sells the product without
-- managing a count). Previously quantity was NOT NULL DEFAULT 0, which forced
-- untracked products to read as "0" (out of stock) on the dashboard. Make it
-- nullable: NULL now means "not tracked → available", a real integer (incl. 0)
-- means a tracked on-hand count. Existing 0s stay 0 (no data loss).
ALTER TABLE "ProductInventory" ALTER COLUMN "quantity" DROP NOT NULL;
ALTER TABLE "ProductInventory" ALTER COLUMN "quantity" DROP DEFAULT;
