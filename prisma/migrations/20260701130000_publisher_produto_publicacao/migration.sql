-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "fotoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "tituloMl" TEXT,
    "tituloShopee" TEXT,
    "descricao" TEXT,
    "categoriaMlId" TEXT,
    "categoriaShopeeId" INTEGER,
    "preco" DECIMAL(14,2) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "condicao" TEXT NOT NULL DEFAULT 'not_specified',
    "atributos" JSONB,
    "payloadMl" JSONB,
    "payloadShopee" JSONB,
    "mlItemId" TEXT,
    "shopeeItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publicacao" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "plataforma" "PublisherPlatform" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "respostaApi" JSONB,
    "erroMensagem" TEXT,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publicacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Produto_clienteId_idx" ON "Produto"("clienteId");

-- CreateIndex
CREATE INDEX "Publicacao_produtoId_idx" ON "Publicacao"("produtoId");

-- CreateIndex
CREATE INDEX "Publicacao_clienteId_idx" ON "Publicacao"("clienteId");

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publicacao" ADD CONSTRAINT "Publicacao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

