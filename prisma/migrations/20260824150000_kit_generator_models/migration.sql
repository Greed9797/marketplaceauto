-- Additive persistence for kit classification, proposals, and approved kits.

CREATE TABLE IF NOT EXISTS "ProductClassification" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "ageBand" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "colorPattern" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductClassification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComplementaryPair" (
    "id" TEXT NOT NULL,
    "categoryA" TEXT NOT NULL,
    "categoryB" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplementaryPair_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KitProposal" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "componentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "comboHash" TEXT NOT NULL,
    "monochromatic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'proposta',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Kit" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aprovado',
    "shopeeItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductClassification_produtoId_key" ON "ProductClassification"("produtoId");
CREATE INDEX IF NOT EXISTS "ProductClassification_needsReview_idx" ON "ProductClassification"("needsReview");
CREATE UNIQUE INDEX IF NOT EXISTS "ComplementaryPair_categoryA_categoryB_key" ON "ComplementaryPair"("categoryA", "categoryB");
CREATE INDEX IF NOT EXISTS "ComplementaryPair_active_idx" ON "ComplementaryPair"("active");
CREATE UNIQUE INDEX IF NOT EXISTS "KitProposal_comboHash_key" ON "KitProposal"("comboHash");
CREATE INDEX IF NOT EXISTS "KitProposal_clienteId_status_idx" ON "KitProposal"("clienteId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "Kit_proposalId_key" ON "Kit"("proposalId");
CREATE INDEX IF NOT EXISTS "Kit_clienteId_status_idx" ON "Kit"("clienteId", "status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductClassification_produtoId_fkey') THEN
        ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_produtoId_fkey"
        FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KitProposal_clienteId_fkey') THEN
        ALTER TABLE "KitProposal" ADD CONSTRAINT "KitProposal_clienteId_fkey"
        FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kit_proposalId_fkey') THEN
        ALTER TABLE "Kit" ADD CONSTRAINT "Kit_proposalId_fkey"
        FOREIGN KEY ("proposalId") REFERENCES "KitProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kit_clienteId_fkey') THEN
        ALTER TABLE "Kit" ADD CONSTRAINT "Kit_clienteId_fkey"
        FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
