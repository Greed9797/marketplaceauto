import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ManualCommerceClient } from "@/lib/connectors/manual-commerce-client";

/**
 * Loja Integrada HTTP client contract (Django Tastypie API at
 * api.awsli.com.br/v1). Locks the wire format so a regression in auth, the
 * date filters, or the offset/meta.next pagination is caught before it silently
 * returns zero orders in production.
 */
describe("Loja Integrada commerce client", () => {
  it("uses chave_api+aplicacao auth and paginates /pedido/search/ by offset until meta.next is null", async () => {
    const fullPage = Array.from({ length: 100 }, (_, idx) => ({
      numero: idx + 1,
      situacao: 4, // pago
      valor_total: "100.00",
      data_criacao: "2026-05-10T10:00:00",
    }));
    const lastPage = [
      {
        numero: 101,
        situacao: 4,
        valor_total: "50.00",
        data_criacao: "2026-05-11T10:00:00",
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          meta: { next: "/api/v1/pedido/search/?offset=100&limit=100" },
          objects: fullPage,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ meta: { next: null }, objects: lastPage }),
      );

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.LOJA_INTEGRADA,
      credentials: {
        apiKey: "chave-da-loja",
        apiSecret: "chave-da-aplicacao",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      since: "2026-05-01",
      until: "2026-05-31",
    });

    // Both pages collected (100 + 1).
    expect(orders).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Auth + content headers on the first request.
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(firstInit.headers).toMatchObject({
      Authorization: "chave_api chave-da-loja aplicacao chave-da-aplicacao",
      "Content-Type": "application/json",
    });

    // First page query: creation-date window + Tastypie offset/limit.
    const url1 = new URL(String(firstUrl));
    expect(url1.pathname).toBe("/v1/pedido/search/");
    expect(url1.searchParams.get("format")).toBe("json");
    expect(url1.searchParams.get("since_criado")).toBe("2026-05-01");
    expect(url1.searchParams.get("until_criado")).toBe("2026-05-31");
    expect(url1.searchParams.get("limit")).toBe("100");
    expect(url1.searchParams.get("offset")).toBe("0");

    // Second page advances the offset by one page.
    const url2 = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url2.searchParams.get("offset")).toBe("100");
  });

  it("stops after one page when meta.next is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        meta: { next: null },
        objects: [{ numero: 1, situacao: 4, valor_total: "10.00" }],
      }),
    );
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.LOJA_INTEGRADA,
      credentials: { apiKey: "k", apiSecret: "s" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      since: "2026-05-01",
      until: "2026-05-31",
    });

    expect(orders).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
