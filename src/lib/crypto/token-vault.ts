import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

type TokenVaultOptions = {
  key?: string;
  keyVersion?: string;
};

export function getTokenEncryptionKey(key = process.env.TOKEN_ENCRYPTION_KEY) {
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  }

  const decoded = Buffer.from(key, "base64");

  if (decoded.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes base64");
  }

  return decoded;
}

export function encryptToken(plaintext: string, options: TokenVaultOptions = {}): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTokenEncryptionKey(options.key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: options.keyVersion ?? "v1",
  };
}

export function decryptToken(token: EncryptedToken, options: TokenVaultOptions = {}) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getTokenEncryptionKey(options.key),
    Buffer.from(token.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(token.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(token.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptTokenEnvelope(plaintext: string, options: TokenVaultOptions = {}) {
  return JSON.stringify(encryptToken(plaintext, options));
}

export function decryptTokenEnvelope(envelope: string, options: TokenVaultOptions = {}) {
  return decryptToken(JSON.parse(envelope) as EncryptedToken, options);
}
