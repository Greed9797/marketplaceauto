import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  normalizeManualCommerceOrder,
  normalizeManualProviderCredentials,
} from "@/lib/connectors/manual-commerce";
import { mapEcommerceOrdersToDailyMetricSummaries } from "@/lib/connectors/ecommerce-sync";

describe("manual ecommerce connectors", () => {
  it("normalizes base urls and API credentials for manual providers", () => {
    expect(
      normalizeManualProviderCredentials({
        provider: ConnectorProvider.WBUY,
        storeName: "Loja WBuy",
        baseUrl: "loja.wbuy.com.br/",
        apiKey: "key",
        apiSecret: "secret",
        apiUser: "user",
        apiPassword: "password",
      }),
    ).toEqual({
      provider: ConnectorProvider.WBUY,
      storeName: "Loja WBuy",
      baseUrl: "https://loja.wbuy.com.br",
      apiKey: "key",
      apiSecret: "secret",
      apiUser: "user",
      apiPassword: "password",
    });
  });

  it("maps loose provider order payloads into the common order shape", () => {
    expect(
      normalizeManualCommerceOrder({
        id: 123,
        numero: "1001",
        total: "199.90",
        moeda: "BRL",
        status: "pago",
        email: "cliente@example.com",
        estado: "SC",
        itens: [
          { nome: "Produto A", quantidade: 1 },
          { name: "Produto B", quantity: 2 },
        ],
        data: "2026-05-18T10:00:00.000Z",
      }),
    ).toEqual({
      externalOrderId: "123",
      orderNumber: "1001",
      orderTotal: "199.90",
      orderCurrency: "BRL",
      customerEmail: "cliente@example.com",
      itemsCount: 3,
      items: [
        {
          productName: "Produto A",
          quantity: 1,
          sku: null,
          total: null,
        },
        {
          productName: "Produto B",
          quantity: 2,
          sku: null,
          total: null,
        },
      ],
      status: "pago",
      shippingState: "SC",
      placedAt: "2026-05-18T10:00:00.000Z",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
  });

  it("maps a Levane (Supabase PostgREST) order, reading total_items as itemsCount", () => {
    expect(
      normalizeManualCommerceOrder({
        id: "o1",
        total: "150.00",
        total_items: 3,
        status: "paid",
        user_id: "u1",
        created_at: "2026-05-10T12:00:00.000Z",
      }),
    ).toMatchObject({
      externalOrderId: "o1",
      orderTotal: "150.00",
      orderCurrency: "BRL",
      itemsCount: 3,
      status: "paid",
      placedAt: "2026-05-10T12:00:00.000Z",
    });
  });

  it("maps WhatsApp Google Sheets rows into approved orders", () => {
    expect(
      normalizeManualCommerceOrder({
        pedido: "WA-42",
        valor: "R$ 1.234,56",
        status: "aprovado",
        estado: "PR",
        origem: "whatsapp",
        data: "2026-05-18T10:00:00.000Z",
      }),
    ).toMatchObject({
      externalOrderId: "WA-42",
      orderNumber: "WA-42",
      orderTotal: "1234.56",
      status: "aprovado",
      shippingState: "PR",
      utmSource: "whatsapp",
    });
  });

  it("maps daily Google Sheets WhatsApp aggregates into external sales", () => {
    expect(
      normalizeManualCommerceOrder({
        pedido: "GOOGLE_SHEETS-2026-05-02",
        valor: "R$ 2.848,75",
        status: "APPROVED",
        origem: "whatsapp",
        data: "2026-05-02T00:00:00.000Z",
        items_count: "11",
      }),
    ).toMatchObject({
      externalOrderId: "GOOGLE_SHEETS-2026-05-02",
      orderTotal: "2848.75",
      itemsCount: 11,
      status: "APPROVED",
      placedAt: "2026-05-02T00:00:00.000Z",
      utmSource: "whatsapp",
    });
  });

  it("summarizes Google Sheets daily metrics by external sales quantity", () => {
    const summaries = mapEcommerceOrdersToDailyMetricSummaries({
      workspaceId: "workspace-1",
      connectorAccountId: "sheets-1",
      provider: ConnectorProvider.GOOGLE_SHEETS,
      orders: [
        {
          externalOrderId: "GOOGLE_SHEETS-2026-05-02",
          orderNumber: "GOOGLE_SHEETS-2026-05-02",
          orderTotal: "2848.75",
          orderCurrency: "BRL",
          customerEmail: null,
          itemsCount: 11,
          items: [],
          status: "APPROVED",
          shippingState: null,
          placedAt: "2026-05-02T00:00:00.000Z",
          utmSource: "whatsapp",
          utmMedium: null,
          utmCampaign: null,
        },
      ],
    });

    expect(summaries[0]).toMatchObject({
      revenue: "2848.75",
      orders: BigInt(11),
    });
  });

  it("normalizes WBuy orders with nested valor_total/status objects and produtos", () => {
    const order = normalizeManualCommerceOrder({
      id: "12638077",
      data: "2026-06-03 10:06:18",
      status: { id: "13", nome: "Em produção" },
      total_itens: "2",
      valor_total: {
        subtotal: "378",
        frete: "10.36",
        total: "388.36",
      },
      produtos: [
        { nome: "Adesivo A", quantidade: 1, total: "189" },
        { nome: "Adesivo B", quantidade: 1, total: "189" },
      ],
    });

    expect(order).toMatchObject({
      externalOrderId: "12638077",
      orderTotal: "388.36",
      status: "Em produção",
      itemsCount: 2,
      placedAt: "2026-06-03 10:06:18",
    });
    const orderItems = order.items ?? [];
    expect(orderItems).toHaveLength(2);
    expect(orderItems[0]).toMatchObject({ productName: "Adesivo A" });
  });

  it("reads the WBuy customer state from cliente.uf", () => {
    // Real WBuy /order carries the buyer's state in cliente.uf — required for
    // the "vendas por estado" breakdown.
    const order = normalizeManualCommerceOrder({
      id: "12638077",
      data: "2026-06-03 10:06:18",
      total_itens: "1",
      valor_total: { total: "388.36" },
      cliente: { nome: "Fulano", uf: "CE", cidade: "Fortaleza" },
      produtos: [{ nome: "Adesivo A", quantidade: 1, total: "189" }],
    });

    expect(order.shippingState).toBe("CE");
  });
});
