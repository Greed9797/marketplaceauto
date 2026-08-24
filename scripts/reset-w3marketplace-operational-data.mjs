import { stat } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const TARGET_SCHEMA = "w3marketplace";

// Authentication and tenancy are the only records intentionally retained.
export const PRESERVED_TABLES = [
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "PasswordResetToken",
  "Workspace",
  "Membership",
  "WorkspaceInvite",
];

// Explicit child-first allowlist. Nothing outside this list can be deleted.
export const OPERATIONAL_TABLES = [
  "DemandAlert",
  "DemandTask",
  "DemandMemberProfile",
  "DemandNotificationConfig",
  "DemandCategory",
  "Publicacao",
  "Kit",
  "KitProposal",
  "ProductClassification",
  "ComplementaryPair",
  "Produto",
  "Cliente",
  "ProductInventory",
  "EcommerceOrderItem",
  "EcommerceOrder",
  "DailyMetric",
  "SyncJob",
  "ConnectorSelectionSession",
  "ConnectorProviderConfig",
  "ConnectorAccount",
  "WorkspaceSyncState",
  "Dashboard",
  "AccountReviewSession",
  "BetaFeedback",
  "Notification",
  "NotificationChannel",
  "WorkspaceAiConfig",
  "PlatformStorage",
  "AuditLog",
];

function parseArguments(argv) {
  const apply = argv.includes("--apply");
  const pooled = argv.includes("--pooled");
  const confirmation = argv.find((arg) => arg.startsWith("--confirm="))?.slice(10);
  const backupPath = argv.find((arg) => arg.startsWith("--backup-confirmed="))?.slice(19);
  return { apply, pooled, confirmation, backupPath };
}

function assertTargetUrl(rawUrl) {
  if (!rawUrl) throw new Error("DIRECT_URL is required.");
  const url = new URL(rawUrl);
  if (url.searchParams.get("schema") !== TARGET_SCHEMA) {
    throw new Error(`Refusing to run: DIRECT_URL must explicitly use schema=${TARGET_SCHEMA}.`);
  }
}

async function countTable(client, table) {
  const rows = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM "${TARGET_SCHEMA}"."${table}"`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function snapshotCounts(client, tables) {
  return Object.fromEntries(
    await Promise.all(tables.map(async (table) => [table, await countTable(client, table)])),
  );
}

async function requireBackup(path) {
  if (!path?.startsWith("/")) {
    throw new Error("--apply requires --backup-confirmed=/absolute/path/to/backup.dump.");
  }
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) {
    throw new Error("The confirmed backup is missing or empty.");
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertTargetUrl(process.env.DIRECT_URL);
  if (args.pooled) assertTargetUrl(process.env.DATABASE_URL);
  if (args.apply) {
    if (args.confirmation !== TARGET_SCHEMA) {
      throw new Error(`--apply requires --confirm=${TARGET_SCHEMA}.`);
    }
    await requireBackup(args.backupPath);
  }

  const prisma = new PrismaClient({
    datasources: {
      db: { url: args.pooled ? process.env.DATABASE_URL : process.env.DIRECT_URL },
    },
  });
  try {
    if (!args.pooled) {
      const schemaRows = await prisma.$queryRaw`SELECT current_schema() AS schema`;
      if (schemaRows[0]?.schema !== TARGET_SCHEMA) {
        throw new Error(`Refusing to run: current_schema() is ${schemaRows[0]?.schema ?? "unknown"}.`);
      }
    }

    const tableRows = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    `;
    const existing = new Set(tableRows.map((row) => row.table_name));
    const missingPreserved = PRESERVED_TABLES.filter((table) => !existing.has(table));
    if (missingPreserved.length > 0) {
      throw new Error(`Required preserved tables are missing: ${missingPreserved.join(", ")}.`);
    }
    const clearable = OPERATIONAL_TABLES.filter((table) => existing.has(table));
    const missingOperational = OPERATIONAL_TABLES.filter((table) => !existing.has(table));
    const before = await snapshotCounts(prisma, [...PRESERVED_TABLES, ...clearable]);

    console.log(
      JSON.stringify(
        {
          mode: args.apply ? "apply" : "dry-run",
          schema: TARGET_SCHEMA,
          connection: args.pooled ? "pooled-explicit-schema" : "direct",
          preserved: Object.fromEntries(PRESERVED_TABLES.map((table) => [table, before[table]])),
          clearable: Object.fromEntries(clearable.map((table) => [table, before[table]])),
          missingOperational,
          note: "Supabase Vault is shared and is intentionally not modified by this reset.",
        },
        null,
        2,
      ),
    );

    if (!args.apply) {
      console.log(
        `Dry-run only. To apply, provide --apply --confirm=${TARGET_SCHEMA} --backup-confirmed=/absolute/path.dump.`,
      );
      return;
    }

    await prisma.$transaction(
      async (tx) => {
        const preservedBefore = await snapshotCounts(tx, PRESERVED_TABLES);
        for (const table of clearable) {
          await tx.$executeRawUnsafe(`DELETE FROM "${TARGET_SCHEMA}"."${table}"`);
        }
        const preservedAfter = await snapshotCounts(tx, PRESERVED_TABLES);
        if (JSON.stringify(preservedBefore) !== JSON.stringify(preservedAfter)) {
          throw new Error("Preserved authentication or tenancy records changed; transaction rolled back.");
        }
      },
      { timeout: 120_000 },
    );

    const after = await snapshotCounts(prisma, [...PRESERVED_TABLES, ...clearable]);
    const nonEmpty = clearable.filter((table) => after[table] !== 0);
    if (nonEmpty.length > 0) {
      throw new Error(`Reset verification failed; non-empty tables: ${nonEmpty.join(", ")}.`);
    }
    console.log(
      JSON.stringify(
        {
          reset: "complete",
          schema: TARGET_SCHEMA,
          preserved: Object.fromEntries(PRESERVED_TABLES.map((table) => [table, after[table]])),
          clearedTables: clearable.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Reset failed.");
    process.exitCode = 1;
  });
}
