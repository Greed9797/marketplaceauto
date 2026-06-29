-- Product category pulled from the store catalog API alongside stock, used to
-- fill the dashboard Categorias widget (joined to sold products by SKU/name).
-- Nullable + additive: existing rows and connectors without a category source
-- keep degrading to "Sem categoria".
ALTER TABLE "ProductInventory" ADD COLUMN "categoryName" TEXT;
