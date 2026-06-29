#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const workspaces = await prisma.workspace.findMany({
  orderBy: { createdAt: "asc" },
  select: { id: true, name: true, slug: true, createdAt: true },
});

for (const ws of workspaces) {
  console.log("\n==========================================");
  console.log(`Workspace: ${ws.name} (${ws.slug})`);
  console.log(`  id=${ws.id}`);
  console.log(`  created=${ws.createdAt.toISOString().slice(0, 10)}`);

  const accounts = await prisma.connectorAccount.findMany({
    where: { workspaceId: ws.id },
    orderBy: [{ provider: "asc" }],
    select: {
      id: true,
      provider: true,
      accountName: true,
      status: true,
      lastSyncedAt: true,
      lastSyncError: true,
      historicalSyncedAt: true,
    },
  });

  if (accounts.length === 0) {
    console.log("  (no connectors)");
    continue;
  }

  for (const acc of accounts) {
    const histFlag = acc.historicalSyncedAt
      ? `✓ ${acc.historicalSyncedAt.toISOString().slice(0, 10)}`
      : "✗ never (next sync = 3y backfill)";
    const lastErr = acc.lastSyncError
      ? `\n      lastSyncError: ${acc.lastSyncError.slice(0, 120)}`
      : "";
    console.log(`  [${acc.provider}] ${acc.accountName}`);
    console.log(`      id=${acc.id}`);
    console.log(`      status=${acc.status}`);
    console.log(
      `      lastSyncedAt=${acc.lastSyncedAt?.toISOString() ?? "(never)"}`,
    );
    console.log(`      historicalSyncedAt=${histFlag}${lastErr}`);

    // Row counts for this connector
    const [dmCount, ecCount, eciCount] = await Promise.all([
      prisma.dailyMetric.count({ where: { connectorAccountId: acc.id } }),
      prisma.ecommerceOrder.count({ where: { connectorAccountId: acc.id } }),
      prisma.ecommerceOrderItem.count({
        where: { connectorAccountId: acc.id },
      }),
    ]);

    // Date span of data
    const [dmMin, dmMax] = await Promise.all([
      prisma.dailyMetric.findFirst({
        where: { connectorAccountId: acc.id },
        orderBy: { date: "asc" },
        select: { date: true },
      }),
      prisma.dailyMetric.findFirst({
        where: { connectorAccountId: acc.id },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
    ]);

    const dmSpan =
      dmMin && dmMax
        ? `${dmMin.date.toISOString().slice(0, 10)} → ${dmMax.date
            .toISOString()
            .slice(0, 10)}`
        : "—";

    console.log(`      DailyMetric rows=${dmCount}  span=${dmSpan}`);
    console.log(`      EcommerceOrder rows=${ecCount}  items=${eciCount}`);
  }

  const syncState = await prisma.workspaceSyncState.findUnique({
    where: { workspaceId: ws.id },
    select: {
      lastSyncedAt: true,
      lastSyncStartedAt: true,
      lastSyncStatus: true,
      syncCount: true,
    },
  });
  if (syncState) {
    console.log("  WorkspaceSyncState:");
    console.log(
      `      lastSyncedAt=${syncState.lastSyncedAt?.toISOString() ?? "(never)"}`,
    );
    console.log(`      status=${syncState.lastSyncStatus}`);
    console.log(`      syncCount=${syncState.syncCount}`);
    console.log(
      `      locked=${
        syncState.lastSyncStartedAt
          ? syncState.lastSyncStartedAt.toISOString()
          : "no"
      }`,
    );
  } else {
    console.log("  WorkspaceSyncState: (none — orchestrator never ran)");
  }
}

await prisma.$disconnect();
