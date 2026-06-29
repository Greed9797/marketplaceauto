import { PrismaClient } from "@prisma/client";
import { connectorAccessTokenFromAccount } from "@/lib/connectors/credentials";

const prisma = new PrismaClient();
const connectorId = process.argv[2] ?? "cmpo3zwsh0001m8hia110aggg";
const campaignId = process.argv[3] ?? "120242863431570474";

const connector = await prisma.connectorAccount.findUniqueOrThrow({
  where: { id: connectorId },
});
const accessToken = await connectorAccessTokenFromAccount(connector);

const url = new URL(
  `https://graph.facebook.com/v25.0/${campaignId}?fields=name,status,effective_status,configured_status,objective,daily_budget,lifetime_budget,start_time,stop_time,updated_time`,
);
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const text = await res.text();
console.log("HTTP", res.status);
console.log(text);

await prisma.$disconnect();
