#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET ?? "";
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN ?? "jfmsrf-qa.myshopify.com";
const REDIRECT_URI = "https://w3ads.vercel.app/api/connectors/shopify/callback";
const API_VERSION = "2026-04";
const SCOPES = "read_orders,read_products,read_customers,read_analytics";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing env vars. Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET before running.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const TARGET_WORKSPACE_ID =
  process.env.TARGET_WORKSPACE_ID ?? "cmpfqky7l0001fp8rsg671hcz";
const workspace = await prisma.workspace.findUnique({
  where: { id: TARGET_WORKSPACE_ID },
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

const baseName = `w3ads:${workspace.id}:SHOPIFY`;
const apiSecretId = await upsertSecret(`${baseName}:apiSecret`, CLIENT_SECRET);
console.log("apiSecret vault id:", apiSecretId);

const upserted = await prisma.connectorProviderConfig.upsert({
  where: {
    workspaceId_provider: {
      workspaceId: workspace.id,
      provider: "SHOPIFY",
    },
  },
  update: {
    status: "ACTIVE",
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    apiVersion: API_VERSION,
    displayName: "Shopify",
    publicCredentials: { apiKey: CLIENT_ID, shopDomain: SHOP_DOMAIN },
    secretRefs: { apiSecret: apiSecretId },
    lastValidatedAt: new Date(),
    lastValidationError: null,
  },
  create: {
    workspaceId: workspace.id,
    provider: "SHOPIFY",
    status: "ACTIVE",
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    apiVersion: API_VERSION,
    displayName: "Shopify",
    publicCredentials: { apiKey: CLIENT_ID, shopDomain: SHOP_DOMAIN },
    secretRefs: { apiSecret: apiSecretId },
    lastValidatedAt: new Date(),
  },
});

console.log("\nConnectorProviderConfig SHOPIFY:");
console.log("  id           :", upserted.id);
console.log("  status       :", upserted.status);
console.log("  redirectUri  :", upserted.redirectUri);
console.log("  apiVersion   :", upserted.apiVersion);
console.log("  scopes       :", upserted.scopes);

// Build OAuth URL preview
const state = "test-" + Date.now();
const oauthUrl =
  `https://${SHOP_DOMAIN}/admin/oauth/authorize?` +
  `client_id=${CLIENT_ID}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&state=${state}`;

console.log("\nOAuth URL preview:");
console.log(oauthUrl);

// Ping shop to confirm domain reachable
const shopPing = await fetch(`https://${SHOP_DOMAIN}/`, { redirect: "manual" });
console.log("\nShop ping HTTP:", shopPing.status, shopPing.headers.get("location") ?? "");

await prisma.$disconnect();
