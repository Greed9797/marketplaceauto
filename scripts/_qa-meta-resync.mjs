#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

import { syncMetaDailyMetrics } from "../src/lib/connectors/meta/sync.ts";

const prisma = new PrismaClient();

const account = await prisma.connectorAccount.findFirst({
  where: { provider: "META_ADS" },
  orderBy: { createdAt: "desc" },
});

if (!account) {
  console.error("No Meta account in DB");
  process.exit(1);
}

console.log(
  `Resyncing connectorAccountId=${account.id} adAccountIdMetadata=${
    account.metadata?.adAccountId ?? "<missing>"
  }`,
);

// Reset status so retry path is clean.
await prisma.connectorAccount.update({
  where: { id: account.id },
  data: { status: "ACTIVE", lastSyncError: null },
});

const since = new Date();
since.setUTCHours(0, 0, 0, 0);
since.setUTCDate(since.getUTCDate() - 30);
const until = new Date();
until.setUTCHours(23, 59, 59, 999);

const result = await syncMetaDailyMetrics({
  connectorAccountId: account.id,
  range: {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  },
  syncType: "BACKFILL",
});

console.log("Sync result:", result);

const metrics = await prisma.dailyMetric.findMany({
  where: { connectorAccountId: account.id },
  select: {
    date: true,
    campaignName: true,
    spend: true,
    impressions: true,
    clicks: true,
    conversions: true,
    leads: true,
  },
  orderBy: { date: "desc" },
  take: 5,
});
console.log(
  "Top metrics:",
  JSON.stringify(
    metrics,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);

await prisma.$disconnect();
