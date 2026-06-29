#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "node:crypto";

const prisma = new PrismaClient();

const key = process.env.TOKEN_ENCRYPTION_KEY;
if (!key) {
  console.error("TOKEN_ENCRYPTION_KEY missing");
  process.exit(1);
}
const keyBuf = Buffer.from(key, "base64");

const account = await prisma.connectorAccount.findFirst({
  where: { provider: "META_ADS" },
  orderBy: { createdAt: "desc" },
});

if (!account) {
  console.error("No Meta account");
  process.exit(1);
}

const iv = Buffer.from(account.tokenIv, "base64");
const authTag = Buffer.from(account.tokenAuthTag, "base64");
const ct = Buffer.from(account.accessTokenCiphertext, "base64");

const decipher = createDecipheriv("aes-256-gcm", keyBuf, iv);
decipher.setAuthTag(authTag);
const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
const parsed = JSON.parse(plaintext);

console.log("Decrypted payload keys:", Object.keys(parsed));
console.log("accessToken length:", parsed.accessToken?.length);
console.log("accessToken first 20:", parsed.accessToken?.slice(0, 20));
console.log("accessToken last 20:", parsed.accessToken?.slice(-20));
console.log("adAccountId:", parsed.adAccountId);
console.log("externalAccountId:", account.externalAccountId);

await prisma.$disconnect();
