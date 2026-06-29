import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const r = await p.workspaceSyncState.updateMany({
  where: { lastSyncStartedAt: { not: null } },
  data: { lastSyncStartedAt: null, lastSyncStatus: "FAILED", lastSyncError: "Lock liberado manualmente (Vercel timeout sem finally)" },
});
console.log(`Released ${r.count} stale lock(s)`);
await p.$disconnect();
