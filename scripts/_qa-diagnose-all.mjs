#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "node:crypto";

const prisma = new PrismaClient();

const key = process.env.TOKEN_ENCRYPTION_KEY;
const keyBuf = key ? Buffer.from(key, "base64") : null;
console.log("TOKEN_ENCRYPTION_KEY present:", Boolean(keyBuf));
console.log("Key length (bytes):", keyBuf?.length ?? 0);

const accounts = await prisma.connectorAccount.findMany({
  select: {
    id: true,
    provider: true,
    accountName: true,
    externalAccountId: true,
    status: true,
    lastSyncedAt: true,
    lastSyncError: true,
    credentialSecretId: true,
    tokenIv: true,
    accessTokenCiphertext: true,
    tokenAuthTag: true,
    tokenKeyVersion: true,
    metadata: true,
  },
  orderBy: { createdAt: "desc" },
});

for (const a of accounts) {
  console.log("\n=========================");
  console.log("Provider:", a.provider);
  console.log("Account:", a.accountName, `(${a.id})`);
  console.log("Status:", a.status);
  console.log("LastSyncedAt:", a.lastSyncedAt);
  console.log("LastSyncError:", a.lastSyncError);
  console.log("CredentialSecretId:", a.credentialSecretId ?? "(none, inline)");
  console.log("Metadata:", JSON.stringify(a.metadata));

  if (a.credentialSecretId) {
    console.log("Storage: VAULT (Supabase Vault secret ref)");
  } else if (a.tokenIv && a.tokenIv !== "vault" && keyBuf) {
    try {
      const iv = Buffer.from(a.tokenIv, "base64");
      const authTag = Buffer.from(a.tokenAuthTag, "base64");
      const ct = Buffer.from(a.accessTokenCiphertext, "base64");
      const decipher = createDecipheriv("aes-256-gcm", keyBuf, iv);
      decipher.setAuthTag(authTag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      const parsed = JSON.parse(pt);
      console.log(
        "Storage: INLINE AES — decrypt OK. keys:",
        Object.keys(parsed),
      );
      if (parsed.accessToken) {
        console.log(
          "  accessToken prefix:",
          parsed.accessToken.slice(0, 12),
          "len:",
          parsed.accessToken.length,
        );
      }
    } catch (err) {
      console.log("Storage: INLINE AES — DECRYPT FAILED:", err.message);
    }
  }
}

await prisma.$disconnect();
