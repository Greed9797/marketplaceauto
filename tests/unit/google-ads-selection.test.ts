import { describe, expect, it } from "vitest";

import {
  GOOGLE_ADS_CUSTOMER_CLIENT_QUERY,
  GoogleAdsClient,
  normalizeGoogleAdsCustomerClientRow,
  selectGoogleAdsAdvertiserAccounts,
} from "@/lib/connectors/google-ads/client";

describe("Google Ads account selection", () => {
  it("uses customer_client to expand MCC hierarchies", () => {
    expect(GOOGLE_ADS_CUSTOMER_CLIENT_QUERY).toContain("customer_client.client_customer");
    expect(GOOGLE_ADS_CUSTOMER_CLIENT_QUERY).toContain("customer_client.manager");
  });

  it("normalizes customer_client rows with manager ancestry", () => {
    expect(
      normalizeGoogleAdsCustomerClientRow(
        {
          customerClient: {
            id: "2223334444",
            clientCustomer: "customers/2223334444",
            descriptiveName: "Cliente Final",
            currencyCode: "BRL",
            timeZone: "America/Sao_Paulo",
            manager: false,
            level: 1,
          },
        },
        { rootCustomerId: "1112223333", loginCustomerId: "1112223333" },
      ),
    ).toEqual({
      id: "2223334444",
      name: "Cliente Final",
      resourceName: "customers/2223334444",
      currencyCode: "BRL",
      timeZone: "America/Sao_Paulo",
      isManager: false,
      level: 1,
      loginCustomerId: "1112223333",
      rootCustomerId: "1112223333",
    });
  });

  it("filters selectable accounts to advertiser clients, not MCC managers", () => {
    expect(
      selectGoogleAdsAdvertiserAccounts([
        {
          id: "111",
          name: "MCC",
          resourceName: "customers/111",
          isManager: true,
          level: 0,
          loginCustomerId: "111",
          rootCustomerId: "111",
        },
        {
          id: "222",
          name: "Cliente",
          resourceName: "customers/222",
          isManager: false,
          level: 1,
          loginCustomerId: "111",
          rootCustomerId: "111",
        },
      ]),
    ).toEqual([
      {
        id: "222",
        name: "Cliente",
        resourceName: "customers/222",
        isManager: false,
        level: 1,
        loginCustomerId: "111",
        rootCustomerId: "111",
      },
    ]);
  });

  it("does not send pageSize to googleAds:search", async () => {
    const calls: Array<[URL | string, RequestInit | undefined]> = [];
    const fetchMock = async (url: URL | string, init?: RequestInit) => {
      calls.push([url, init]);

      return Response.json({ results: [] });
    };
    const client = new GoogleAdsClient({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        developerToken: "developer-token",
        redirectUri: "https://app.w3ads.com.br/api/connectors/google-ads/callback",
        apiVersion: "v24",
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    await client.searchCampaignMetrics({
      accessToken: "access-token",
      customerId: "222",
      since: "2026-05-01",
      until: "2026-05-18",
      loginCustomerId: "111",
    });

    const [, init] = calls[0];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("pageSize");
  });

  it("recursively expands sub-MCC hierarchies and returns final advertisers only", async () => {
    const fetchMock = async (url: URL | string) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith("/customers:listAccessibleCustomers")) {
        return Response.json({ resourceNames: ["customers/111"] });
      }

      if (requestUrl.includes("/customers/111/googleAds:search")) {
        return Response.json({
          results: [
            {
              customerClient: {
                id: "222",
                clientCustomer: "customers/222",
                descriptiveName: "Sub MCC",
                manager: true,
                level: 1,
              },
            },
            {
              customerClient: {
                id: "333",
                clientCustomer: "customers/333",
                descriptiveName: "Cliente Direto",
                manager: false,
                level: 1,
              },
            },
          ],
        });
      }

      if (requestUrl.includes("/customers/222/googleAds:search")) {
        return Response.json({
          results: [
            {
              customerClient: {
                id: "444",
                clientCustomer: "customers/444",
                descriptiveName: "Cliente Sub MCC",
                manager: false,
                level: 1,
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected Google Ads URL ${requestUrl}`);
    };
    const client = new GoogleAdsClient({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        developerToken: "developer-token",
        redirectUri: "https://app.w3ads.com.br/api/connectors/google-ads/callback",
        apiVersion: "v24",
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(client.listSelectableCustomers("access-token")).resolves.toEqual([
      expect.objectContaining({
        id: "333",
        name: "Cliente Direto",
        isManager: false,
        loginCustomerId: "111",
        rootCustomerId: "111",
      }),
      expect.objectContaining({
        id: "444",
        name: "Cliente Sub MCC",
        isManager: false,
        loginCustomerId: "111",
        rootCustomerId: "111",
      }),
    ]);
  });
});
