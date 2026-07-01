-- CreateEnum
CREATE TYPE "PublisherPlatform" AS ENUM ('SHOPEE', 'MERCADO_LIVRE');

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nicho" TEXT,
    "estiloDescricao" TEXT,
    "exemplosTitulos" TEXT,
    "exemplosDescricoes" TEXT,
    "dadosFiscais" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteConnection" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "platform" "PublisherPlatform" NOT NULL,
    "accessTokenCiphertext" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT,
    "tokenIv" TEXT NOT NULL,
    "tokenAuthTag" TEXT NOT NULL,
    "tokenKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    "externalId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cliente_workspaceId_idx" ON "Cliente"("workspaceId");

-- CreateIndex
CREATE INDEX "ClienteConnection_clienteId_idx" ON "ClienteConnection"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "ClienteConnection_clienteId_platform_key" ON "ClienteConnection"("clienteId", "platform");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteConnection" ADD CONSTRAINT "ClienteConnection_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

