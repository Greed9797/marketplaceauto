#!/usr/bin/env node
import { config } from "dotenv";
config();
config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const target = process.argv[2];

if (!target) {
  console.error(
    "usage: node scripts/_qa-trigger-backfill.mjs <connectorAccountId>",
  );
  process.exit(1);
}

const acc = await prisma.connectorAccount.findUnique({
  where: { id: target },
  select: {
    id: true,
    provider: true,
    accountName: true,
    historicalSyncedAt: true,
  },
});

if (!acc) {
  console.error("not found");
  process.exit(1);
}

console.log(
  `Triggering sync for ${acc.provider} "${acc.accountName}" (id=${acc.id})`,
);
console.log(
  `  historicalSyncedAt BEFORE: ${acc.historicalSyncedAt ?? "null (=> 3y backfill)"}`,
);

const { SYNC_HELPERS } = await import("../src/lib/connectors/sync-helpers");
const { computeForegroundRange } =
  await import("../src/lib/connectors/sync-range");

const helper = SYNC_HELPERS[acc.provider];
if (!helper) {
  console.error(`no helper for ${acc.provider}`);
  process.exit(1);
}

const range = computeForegroundRange();
console.log(
  `  range: ${range.since.slice(0, 10)} → ${range.until.slice(0, 10)}`,
);

const start = Date.now();
try {
  const result = await helper({ connectorAccountId: acc.id, range });
  const elapsed = Date.now() - start;
  console.log(`  ✓ sync OK in ${(elapsed / 1000).toFixed(1)}s`, result);
} catch (err) {
  const elapsed = Date.now() - start;
  console.error(
    `  ✗ sync FAILED in ${(elapsed / 1000).toFixed(1)}s:`,
    err instanceof Error ? err.message : err,
  );
}

const after = await prisma.connectorAccount.findUnique({
  where: { id: acc.id },
  select: { historicalSyncedAt: true, lastSyncedAt: true, lastSyncError: true },
});
console.log(
  `  historicalSyncedAt AFTER:  ${after?.historicalSyncedAt ?? "null (still!)"}`,
);
console.log(`  lastSyncedAt: ${after?.lastSyncedAt ?? "(none)"}`);
console.log(`  lastSyncError: ${after?.lastSyncError ?? "null"}`);

await prisma.$disconnect();
