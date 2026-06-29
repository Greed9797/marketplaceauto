#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sessions = await prisma.connectorSelectionSession.findMany({
  where: { provider: "GOOGLE_ADS" },
  select: {
    id: true,
    status: true,
    workspaceId: true,
    expiresAt: true,
    consumedAt: true,
    createdAt: true,
    accounts: true,
  },
  orderBy: { createdAt: "desc" },
  take: 5,
});

console.log(`Total sessions: ${sessions.length}`);
for (const s of sessions) {
  const accountsList = Array.isArray(s.accounts) ? s.accounts : [];
  console.log({
    id: s.id,
    status: s.status,
    workspaceId: s.workspaceId,
    expiresAt: s.expiresAt,
    consumedAt: s.consumedAt,
    createdAt: s.createdAt,
    accountsCount: accountsList.length,
    firstAccount: accountsList[0] ?? null,
  });
}

const audits = await prisma.auditLog.findMany({
  where: {
    action: {
      in: [
        "connector.google_ads.connect",
        "connector.google_ads.selection_created",
        "connector.selection.connect",
      ],
    },
  },
  orderBy: { createdAt: "desc" },
  take: 10,
  select: {
    action: true,
    createdAt: true,
    resourceId: true,
    metadata: true,
  },
});
console.log("\nRecent Google Ads audits:");
for (const a of audits) {
  console.log({
    action: a.action,
    createdAt: a.createdAt,
    resourceId: a.resourceId,
    metadata: a.metadata,
  });
}

await prisma.$disconnect();
