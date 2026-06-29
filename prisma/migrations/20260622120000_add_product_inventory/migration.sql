-- Current available stock per product per store connector. Populated by the
-- inventory sync (Loja Integrada first); joined into the dashboard products
-- table by productName. Distinct from EcommerceOrderItem.quantity (units sold).
CREATE TABLE "ProductInventory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectorAccountId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "sku" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductInventory_connectorAccountId_externalProductId_key" ON "ProductInventory"("connectorAccountId", "externalProductId");

CREATE INDEX "ProductInventory_workspaceId_productName_idx" ON "ProductInventory"("workspaceId", "productName");

CREATE INDEX "ProductInventory_workspaceId_sku_idx" ON "ProductInventory"("workspaceId", "sku");

ALTER TABLE "ProductInventory" ADD CONSTRAINT "ProductInventory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductInventory" ADD CONSTRAINT "ProductInventory_connectorAccountId_fkey" FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
