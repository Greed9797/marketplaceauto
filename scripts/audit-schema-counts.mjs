import { PrismaClient } from "@prisma/client";

const allowedSchemas = new Set(["w3ads", "w3marketplace"]);
const expectedSchema = process.argv.find((arg) => arg.startsWith("--schema="))?.slice(9);
if (!allowedSchemas.has(expectedSchema)) {
  console.error("Use --schema=w3ads or --schema=w3marketplace.");
  process.exit(1);
}
const configuredSchema = process.env.DIRECT_URL
  ? new URL(process.env.DIRECT_URL).searchParams.get("schema")
  : null;
if (configuredSchema !== expectedSchema) {
  console.error(`DIRECT_URL schema ${configuredSchema ?? "missing"} does not match ${expectedSchema}.`);
  process.exit(1);
}

const tables = [
  "User",
  "Workspace",
  "Membership",
  "Session",
  "ConnectorAccount",
  "DailyMetric",
  "EcommerceOrder",
  "EcommerceOrderItem",
  "ProductInventory",
  "Cliente",
  "Produto",
  "Publicacao",
  "DemandCategory",
  "DemandTask",
  "DemandAlert",
];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});
try {
  const schemaRows = await prisma.$queryRaw`SELECT current_schema() AS schema`;
  if (schemaRows[0]?.schema !== expectedSchema) {
    throw new Error(`current_schema() returned ${schemaRows[0]?.schema ?? "unknown"}.`);
  }
  const existingRows = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  `;
  const existing = new Set(existingRows.map((row) => row.table_name));
  const counts = {};
  for (const table of tables.filter((name) => existing.has(name))) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM "${expectedSchema}"."${table}"`,
    );
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  console.log(JSON.stringify({ schema: expectedSchema, counts }, null, 2));
} finally {
  await prisma.$disconnect();
}
