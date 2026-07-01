-- DropForeignKey
ALTER TABLE "ClienteConnection" DROP CONSTRAINT "ClienteConnection_clienteId_fkey";

-- AlterTable
ALTER TABLE "ConnectorAccount" ADD COLUMN     "clienteId" TEXT;

-- DropTable
DROP TABLE "ClienteConnection";

-- CreateIndex
CREATE INDEX "ConnectorAccount_clienteId_idx" ON "ConnectorAccount"("clienteId");

-- AddForeignKey
ALTER TABLE "ConnectorAccount" ADD CONSTRAINT "ConnectorAccount_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

