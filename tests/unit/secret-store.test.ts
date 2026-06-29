import { describe, expect, it } from "vitest";

import {
  MemorySecretStore,
  secretHandleForPublicPayload,
  serializeSecretRefs,
} from "@/lib/security/secret-store";

describe("secret store", () => {
  it("stores and retrieves secrets by opaque ids", async () => {
    const store = new MemorySecretStore();
    const id = await store.createSecret({
      name: "google-client-secret",
      value: "super-secret",
      description: "Google Ads client secret",
    });

    expect(id).not.toContain("super-secret");
    expect(await store.getSecret(id)).toBe("super-secret");
  });

  it("serializes only secret handles for public payloads", () => {
    expect(
      serializeSecretRefs({
        clientSecret: "vault-secret-id",
        developerToken: undefined,
        webhookSecret: null,
      }),
    ).toEqual({ clientSecret: "vault-secret-id" });
    expect(secretHandleForPublicPayload("vault-secret-id")).toEqual({ configured: true });
  });
});
