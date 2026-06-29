#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const result = {};

result.providerConfig = await prisma.connectorProviderConfig.findFirst({
  where: { provider: "GOOGLE_ADS" },
  select: {
    id: true,
    status: true,
    redirectUri: true,
    apiVersion: true,
    publicCredentials: true,
    secretRefs: true,
    lastValidatedAt: true,
    lastValidationError: true,
  },
});

result.accounts = await prisma.connectorAccount.findMany({
  where: { provider: "GOOGLE_ADS" },
  select: {
    id: true,
    accountName: true,
    externalAccountId: true,
    status: true,
    lastSyncedAt: true,
    lastSyncError: true,
    credentialSecretId: true,
    tokenIv: true,
    metadata: true,
    tokenExpiresAt: true,
    createdAt: true,
    updatedAt: true,
  },
  orderBy: { createdAt: "desc" },
});

result.syncJobs = await prisma.syncJob.findMany({
  where: { provider: "GOOGLE_ADS" },
  select: {
    id: true,
    status: true,
    syncType: true,
    startedAt: true,
    finishedAt: true,
    rowsUpdated: true,
    errorMessage: true,
  },
  orderBy: { startedAt: "desc" },
  take: 5,
});

result.metricsCount = await prisma.dailyMetric.count({
  where: { source: "GOOGLE_ADS" },
});

result.metricsSample = await prisma.dailyMetric.findMany({
  where: { source: "GOOGLE_ADS" },
  orderBy: { date: "desc" },
  take: 3,
});

console.log(
  JSON.stringify(
    result,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);

await prisma.$disconnect();
