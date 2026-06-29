import { describe, expect, it } from "vitest";

import {
  decryptConnectorCredentials,
  encryptConnectorCredentials,
  stableExternalAccountId,
} from "@/lib/connectors/credentials";

const key = Buffer.alloc(32, 7).toString("base64");

describe("connector credential vault", () => {
  it("encrypts arbitrary credential payloads without leaving plaintext in the ciphertext", () => {
    const encrypted = encryptConnectorCredentials(
      {
        accessToken: "access-token",
        baseUrl: "https://loja.example.com",
        apiUser: "api-user",
        apiPassword: "api-password",
      },
      { key },
    );

    expect(encrypted.ciphertext).not.toContain("access-token");
    expect(encrypted.ciphertext).not.toContain("api-password");
    expect(
      decryptConnectorCredentials(encrypted, { key }),
    ).toEqual({
      accessToken: "access-token",
      baseUrl: "https://loja.example.com",
      apiUser: "api-user",
      apiPassword: "api-password",
    });
  });

  it("creates stable opaque external ids from provider and account seed", () => {
    expect(stableExternalAccountId("WBUY", "https://loja.wbuy.com.br")).toBe(
      stableExternalAccountId("WBUY", "https://loja.wbuy.com.br"),
    );
    expect(stableExternalAccountId("TRAY", "https://loja.wbuy.com.br")).not.toBe(
      stableExternalAccountId("WBUY", "https://loja.wbuy.com.br"),
    );
  });
});
