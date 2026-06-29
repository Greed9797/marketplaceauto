import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const states = await p.workspaceSyncState.findMany({
  select: {
    workspaceId: true,
    lastSyncedAt: true,
    lastSyncStartedAt: true,
    lastSyncStatus: true,
    lastSyncError: true,
    syncCount: true,
    triggeredBy: true,
    updatedAt: true,
  },
});
const now = Date.now();
for (const s of states) {
  const lastAgoMin = s.lastSyncedAt
    ? Math.floor((now - s.lastSyncedAt.getTime()) / 60000)
    : null;
  const lockAgoMin = s.lastSyncStartedAt
    ? Math.floor((now - s.lastSyncStartedAt.getTime()) / 60000)
    : null;
  console.log(`workspace=${s.workspaceId}`);
  console.log(`  lastSyncedAt=${s.lastSyncedAt?.toISOString()}  (${lastAgoMin}min ago)`);
  console.log(`  lastSyncStartedAt=${s.lastSyncStartedAt?.toISOString() ?? "(null)"}  (${lockAgoMin}min ago)`);
  console.log(`  status=${s.lastSyncStatus}  triggeredBy=${s.triggeredBy}  syncCount=${s.syncCount}`);
  console.log(`  lastSyncError=${s.lastSyncError?.slice(0, 200) ?? "null"}`);
}
await p.$disconnect();
