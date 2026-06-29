import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const m = await p.dailyMetric.count({
  where: { connectorAccountId: "cmpo3zwsh0001m8hia110aggg" },
});
const g = await p.dailyMetric.count({
  where: { connectorAccountId: "cmpnzrydu000572vcdm2egvaj" },
});
console.log({ metaGM: m, ga4GM: g });
await p.$disconnect();
