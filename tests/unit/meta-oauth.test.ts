import { describe, expect, it, vi } from "vitest";

import { MetaMarketingClient } from "@/lib/connectors/meta/client";
import { META_OAUTH_SCOPES, buildMetaOAuthUrl } from "@/lib/connectors/meta/oauth";

const metaConfig = {
  appId: "123",
  appSecret: "secret",
  redirectUri: "http://localhost:3000/api/connectors/meta/callback",
  apiVersion: "v25.0",
};

describe("Meta OAuth helpers", () => {
  it("builds the Facebook OAuth URL from workspace provider config", () => {
    const url = buildMetaOAuthUrl({ state: "csrf-state", config: metaConfig });

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v25.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("redirect_uri")).toBe(metaConfig.redirectUri);
    expect(url.searchParams.get("state")).toBe("csrf-state");
    expect(url.searchParams.get("scope")).toBe(META_OAUTH_SCOPES.join(","));
  });

  it("exchanges the code with POST so app secret is not placed in the URL", async () => {
    const fetchMock = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
      void url;
      void init;
      return Response.json({ access_token: "token" });
    });
    const client = new MetaMarketingClient({
      config: {
        appId: metaConfig.appId,
        appSecret: metaConfig.appSecret,
        redirectUri: metaConfig.redirectUri,
        apiVersion: metaConfig.apiVersion,
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.exchangeCodeForShortLivedToken("auth-code");

    const [url, init] = fetchMock.mock.calls[0] as [URL | string | Request, RequestInit];
    expect(String(url)).not.toContain("secret");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("client_secret=secret");
  });
});
