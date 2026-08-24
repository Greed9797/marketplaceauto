-- Optional during rollout; publishing requires the relation at runtime.
ALTER TABLE "Kit" ADD COLUMN "produtoId" TEXT;

CREATE UNIQUE INDEX "Kit_produtoId_key" ON "Kit"("produtoId");

ALTER TABLE "Kit"
ADD CONSTRAINT "Kit_produtoId_fkey"
FOREIGN KEY ("produtoId") REFERENCES "Produto"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
