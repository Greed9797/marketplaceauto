import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  buildShopifyWebhookAddress,
  normalizeShopifyOrder,
  normalizeShopifyWebhookOrder,
  ShopifyClient,
} from "@/lib/connectors/shopify/client";
import {
  mapShopifyOrderToEcommerceOrder,
  mapShopifyOrdersToDailyMetricSummaries,
} from "@/lib/connectors/shopify/sync";

describe("Shopify orders normalization", () => {
  it("normalizes GraphQL order nodes", () => {
    const order = normalizeShopifyOrder({
      id: "gid://shopify/Order/123",
      name: "#1001",
      createdAt: "2026-05-01T10:00:00Z",
      displayFinancialStatus: "PAID",
      totalPriceSet: { shopMoney: { amount: "199.90", currencyCode: "BRL" } },
      customer: { email: "cliente@example.com" },
      lineItems: {
        edges: [
          { node: { quantity: 2 } },
          { node: { quantity: 1 } },
        ],
      },
    });

    expect(order).toMatchObject({
      externalOrderId: "gid://shopify/Order/123",
      orderNumber: "#1001",
      orderTotal: "199.90",
      orderCurrency: "BRL",
      customerEmail: "cliente@example.com",
      itemsCount: 3,
      status: "PAID",
    });
  });

  it("maps Shopify orders to EcommerceOrder payloads", () => {
    const payload = mapShopifyOrderToEcommerceOrder({
      workspaceId: "workspace-1",
      connectorAccountId: "connector-1",
      order: {
        externalOrderId: "gid://shopify/Order/123",
        orderNumber: "#1001",
        orderTotal: "199.90",
        orderCurrency: "BRL",
        customerEmail: "cliente@example.com",
        itemsCount: 3,
        status: "PAID",
        placedAt: "2026-05-01T10:00:00Z",
      },
    });

    expect(payload.platform).toBe(ConnectorProvider.SHOPIFY);
    expect(payload.externalOrderId).toBe("gid://shopify/Order/123");
    expect(payload.itemsCount).toBe(3);
  });

  it("normalizes order webhook payloads", () => {
    const order = normalizeShopifyWebhookOrder({
      id: 123,
      name: "#1001",
      created_at: "2026-05-01T10:00:00Z",
      financial_status: "paid",
      total_price: "199.90",
      currency: "BRL",
      email: "cliente@example.com",
      line_items: [{ quantity: 2 }, { quantity: 1 }],
      landing_site: "?utm_source=meta&utm_medium=cpc&utm_campaign=maio",
    });

    expect(order).toMatchObject({
      externalOrderId: "gid://shopify/Order/123",
      orderNumber: "#1001",
      orderTotal: "199.90",
      orderCurrency: "BRL",
      customerEmail: "cliente@example.com",
      itemsCount: 3,
      status: "PAID",
      utmSource: "meta",
      utmMedium: "cpc",
      utmCampaign: "maio",
    });
  });

  it("aggregates Shopify webhook orders into daily metric summaries", () => {
    const summaries = mapShopifyOrdersToDailyMetricSummaries({
      workspaceId: "workspace-1",
      connectorAccountId: "connector-1",
      orders: [
        {
          externalOrderId: "gid://shopify/Order/123",
          orderNumber: "#1001",
          orderTotal: "199.90",
          orderCurrency: "BRL",
          customerEmail: null,
          itemsCount: 3,
          status: "PAID",
          placedAt: "2026-05-01T10:00:00Z",
        },
        {
          externalOrderId: "gid://shopify/Order/124",
          orderNumber: "#1002",
          orderTotal: "50.10",
          orderCurrency: "BRL",
          customerEmail: null,
          itemsCount: 1,
          status: "PAID",
          placedAt: "2026-05-01T11:00:00Z",
        },
      ],
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      revenue: "250.00",
      orders: BigInt(2),
    });
  });

  it("derives the Shopify webhook address from the configured redirect URI", () => {
    expect(
      buildShopifyWebhookAddress({
        redirectUri: "https://app.w3ads.com.br/api/connectors/shopify/callback",
      }),
    ).toBe("https://app.w3ads.com.br/api/webhooks/shopify");
  });

  it("creates webhook subscriptions through the GraphQL Admin API", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          webhookSubscriptionCreate: {
            webhookSubscription: { id: "gid://shopify/WebhookSubscription/1" },
            userErrors: [],
          },
        },
      }),
    );
    const client = new ShopifyClient({
      config: {
        apiKey: "api-key",
        apiSecret: "api-secret",
        redirectUri: "https://app.w3ads.com.br/api/connectors/shopify/callback",
        scopes: "read_orders",
        apiVersion: "2026-04",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.ensureWebhookSubscriptions({
      shop: "loja.myshopify.com",
      accessToken: "shop-token",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://loja.myshopify.com/admin/api/2026-04/graphql.json");
    expect(String(init.body)).toContain("webhookSubscriptionCreate");
    expect(JSON.parse(String(init.body)).variables).toMatchObject({
      topic: "ORDERS_CREATE",
      webhookSubscription: {
        callbackUrl: "https://app.w3ads.com.br/api/webhooks/shopify",
        format: "JSON",
      },
    });
  });
});
