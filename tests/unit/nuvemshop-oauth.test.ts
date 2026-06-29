import { describe, expect, it, vi } from "vitest";

import { NuvemshopClient } from "@/lib/connectors/nuvemshop/client";
import { buildNuvemshopOAuthUrl } from "@/lib/connectors/nuvemshop/oauth";

const config = {
  clientId: "app-id",
  clientSecret: "app-secret",
  redirectUri: "http://localhost:3000/api/connectors/nuvemshop/callback",
  apiBaseUrl: "https://api.nuvemshop.com.br/v1",
};

describe("Nuvemshop OAuth", () => {
  it("builds the install URL with state from workspace provider config", () => {
    const url = buildNuvemshopOAuthUrl({ state: "csrf-state", config });

    expect(url.toString()).toBe(
      "https://www.nuvemshop.com.br/apps/app-id/authorize?state=csrf-state",
    );
  });

  it("exchanges the code for a non-expiring store token", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "store-token",
        token_type: "bearer",
        scope: "read_orders",
        user_id: 2093261,
      }),
    );
    const client = new NuvemshopClient({
      config: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        apiBaseUrl: config.apiBaseUrl,
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.exchangeCodeForAccessToken("code")).resolves.toEqual({
      accessToken: "store-token",
      tokenType: "bearer",
      scope: "read_orders",
      storeId: "2093261",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://www.nuvemshop.com.br/apps/authorize/token");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "app-id",
      client_secret: "app-secret",
      grant_type: "authorization_code",
      code: "code",
    });
  });

  it("lists orders with Authentication bearer header and paginates by page number", async () => {
    // A full page (per_page=200) forces the client to fetch the next page; a
    // short page (<200) signals the window is exhausted. Pagination is by page
    // number, not the Link header, so resume-by-page is deterministic.
    const fullPage = Array.from({ length: 200 }, (_, idx) => ({
      id: idx + 1,
      total: "100.00",
      created_at: "2026-05-01T10:00:00Z",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(fullPage))
      .mockResolvedValueOnce(
        Response.json([
          { id: 201, total: "50.00", created_at: "2026-05-02T10:00:00Z" },
        ]),
      );
    const client = new NuvemshopClient({
      config,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.listOrders({
      storeId: "2093261",
      accessToken: "store-token",
      since: "2026-05-01",
      until: "2026-05-18",
    });
    expect(result.orders).toHaveLength(201);
    expect(result.complete).toBe(true);

    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(firstInit.headers).toMatchObject({
      Authentication: "bearer store-token",
    });
    expect(firstInit.headers).not.toHaveProperty("Authorization");
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.searchParams.get("page")).toBe("1");
    expect(firstUrl.searchParams.get("payment_status")).toBe("paid");
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(secondUrl.searchParams.get("page")).toBe("2");
  });
});
