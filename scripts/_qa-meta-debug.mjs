#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const result = {};

result.connectorAccounts = await prisma.connectorAccount.findMany({
  where: { provider: "META_ADS" },
  select: {
    id: true,
    accountName: true,
    externalAccountId: true,
    status: true,
    lastSyncedAt: true,
    lastSyncError: true,
    credentialSecretId: true,
    tokenIv: true,
    accessTokenCiphertext: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
  },
  orderBy: { createdAt: "desc" },
  take: 5,
});

result.syncJobs = await prisma.syncJob.findMany({
  where: { provider: "META_ADS" },
  select: {
    id: true,
    status: true,
    syncType: true,
    startedAt: true,
    finishedAt: true,
    rowsUpdated: true,
    errorMessage: true,
    metadata: true,
  },
  orderBy: { startedAt: "desc" },
  take: 5,
});

result.dailyMetricsCount = await prisma.dailyMetric.count({
  where: { source: "META_ADS" },
});

result.dailyMetricsSample = await prisma.dailyMetric.findMany({
  where: { source: "META_ADS" },
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
  take: 3,
});

for (const account of result.connectorAccounts) {
  account.accessTokenCiphertext =
    account.accessTokenCiphertext === "vault"
      ? "vault"
      : `inline:${account.accessTokenCiphertext.length}chars`;
}

console.log(
  JSON.stringify(
    result,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);

await prisma.$disconnect();
