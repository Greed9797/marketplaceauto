#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
const REDIRECT_URI = "https://w3ads.vercel.app/api/connectors/google-ads/callback";
const API_VERSION = "v24";
const SCOPES = "https://www.googleapis.com/auth/adwords";

if (!CLIENT_ID || !CLIENT_SECRET || !DEVELOPER_TOKEN) {
  console.error(
    "Missing env vars. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_ADS_DEVELOPER_TOKEN before running.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const workspace = await prisma.workspace.findFirst({
  orderBy: { createdAt: "asc" },
});
if (!workspace) {
  console.error("no workspace");
  process.exit(1);
}
console.log("Workspace:", workspace.id, workspace.name);

async function upsertSecret(name, value) {
  const existing = await prisma.$queryRawUnsafe(
    "SELECT id::text AS id FROM vault.secrets WHERE name = $1 LIMIT 1",
    name,
  );
  if (existing.length > 0) {
    const id = existing[0].id;
    await prisma.$executeRawUnsafe(
      "SELECT vault.update_secret($1::uuid, $2, $3, $4)",
      id,
      value,
      name,
      name,
    );
    return id;
  }
  const rows = await prisma.$queryRawUnsafe(
    "SELECT vault.create_secret($1, $2, $3)::text AS id",
    value,
    name,
    name,
  );
  return rows[0].id;
}

const baseName = `w3ads:${workspace.id}:GOOGLE_ADS`;

const clientSecretId = await upsertSecret(
  `${baseName}:clientSecret`,
  CLIENT_SECRET,
);
const developerTokenSecretId = await upsertSecret(
  `${baseName}:developerToken`,
  DEVELOPER_TOKEN,
);

console.log("Secrets created:");
console.log("  clientSecret    :", clientSecretId);
console.log("  developerToken  :", developerTokenSecretId);

const upserted = await prisma.connectorProviderConfig.upsert({
  where: {
    workspaceId_provider: {
      workspaceId: workspace.id,
      provider: "GOOGLE_ADS",
    },
  },
  update: {
    status: "ACTIVE",
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    apiVersion: API_VERSION,
    displayName: "Google Ads",
    publicCredentials: { clientId: CLIENT_ID },
    secretRefs: {
      clientSecret: clientSecretId,
      developerToken: developerTokenSecretId,
    },
    lastValidatedAt: new Date(),
    lastValidationError: null,
  },
  create: {
    workspaceId: workspace.id,
    provider: "GOOGLE_ADS",
    status: "ACTIVE",
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    apiVersion: API_VERSION,
    displayName: "Google Ads",
    publicCredentials: { clientId: CLIENT_ID },
    secretRefs: {
      clientSecret: clientSecretId,
      developerToken: developerTokenSecretId,
    },
    lastValidatedAt: new Date(),
  },
});

console.log("\nConnectorProviderConfig OK:");
console.log("  id           :", upserted.id);
console.log("  provider     :", upserted.provider);
console.log("  status       :", upserted.status);
console.log("  redirectUri  :", upserted.redirectUri);
console.log("  apiVersion   :", upserted.apiVersion);
console.log(
  "  publicCreds  :",
  JSON.stringify(upserted.publicCredentials),
);
console.log("  secretRefs   :", JSON.stringify(upserted.secretRefs));

await prisma.$disconnect();
console.log("\nReady. Now go to /connectors → Conectar Google Ads to start OAuth.");
