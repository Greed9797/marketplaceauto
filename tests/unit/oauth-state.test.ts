import { describe, expect, it } from "vitest";

import {
  createConnectorOAuthState,
  parseConnectorOAuthState,
  verifyConnectorOAuthState,
} from "@/lib/connectors/oauth-state";

const secret = "state-secret";

describe("connector OAuth state", () => {
  it("signs state with provider, user, workspace and shop context", () => {
    const state = createConnectorOAuthState(
      {
        provider: "SHOPIFY",
        userId: "user-1",
        workspaceId: "workspace-1",
        shop: "loja.myshopify.com",
      },
      { secret, now: 1_778_966_400_000, nonce: "nonce-1" },
    );

    expect(state).not.toContain("workspace-1");

    const parsed = parseConnectorOAuthState(state);
    expect(parsed.payload).toMatchObject({
      provider: "SHOPIFY",
      userId: "user-1",
      workspaceId: "workspace-1",
      shop: "loja.myshopify.com",
      nonce: "nonce-1",
    });
    expect(parsed.payload.issuedAt).toBe(1_778_966_400_000);
  });

  it("rejects tampered state and mismatched workspace context", () => {
    const state = createConnectorOAuthState(
      {
        provider: "GOOGLE_ADS",
        userId: "user-1",
        workspaceId: "workspace-1",
      },
      { secret, now: 1_778_966_400_000, nonce: "nonce-1" },
    );
    const tampered = `${state.slice(0, -1)}x`;

    expect(
      verifyConnectorOAuthState(state, {
        secret,
        expectedProvider: "GOOGLE_ADS",
        expectedUserId: "user-1",
        expectedWorkspaceId: "workspace-2",
        now: 1_778_966_401_000,
      }).valid,
    ).toBe(false);
    expect(
      verifyConnectorOAuthState(tampered, {
        secret,
        expectedProvider: "GOOGLE_ADS",
        expectedUserId: "user-1",
        expectedWorkspaceId: "workspace-1",
        now: 1_778_966_401_000,
      }).valid,
    ).toBe(false);
  });

  it("rejects expired state", () => {
    const state = createConnectorOAuthState(
      {
        provider: "META_ADS",
        userId: "user-1",
        workspaceId: "workspace-1",
      },
      { secret, now: 1_778_966_400_000, nonce: "nonce-1" },
    );

    expect(
      verifyConnectorOAuthState(state, {
        secret,
        expectedProvider: "META_ADS",
        expectedUserId: "user-1",
        expectedWorkspaceId: "workspace-1",
        now: 1_778_967_100_001,
        maxAgeMs: 10 * 60 * 1000,
      }).valid,
    ).toBe(false);
  });
});
