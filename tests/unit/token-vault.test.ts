import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken, getTokenEncryptionKey } from "@/lib/crypto/token-vault";

const TEST_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

describe("token vault", () => {
  it("encrypts and decrypts an OAuth token with AES-256-GCM", () => {
    const encrypted = encryptToken("meta-secret-token", { key: TEST_KEY });

    expect(encrypted.ciphertext).not.toContain("meta-secret-token");
    expect(encrypted.iv).toHaveLength(16);
    expect(encrypted.authTag).toHaveLength(24);
    expect(encrypted.keyVersion).toBe("v1");
    expect(decryptToken(encrypted, { key: TEST_KEY })).toBe("meta-secret-token");
  });

  it("rejects invalid key sizes", () => {
    const invalidKey = Buffer.from("short").toString("base64");

    expect(() => getTokenEncryptionKey(invalidKey)).toThrow(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes base64",
    );
  });
});
