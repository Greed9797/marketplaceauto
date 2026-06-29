import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const id = process.argv[2];
if (!id) {
  console.error("usage: tsx _qa-mark-historical.ts <connectorAccountId>");
  process.exit(1);
}

const r = await prisma.connectorAccount.update({
  where: { id },
  data: { historicalSyncedAt: new Date(), lastSyncError: null },
  select: { provider: true, accountName: true, historicalSyncedAt: true },
});
console.log("OK:", r);

await prisma.$disconnect();
