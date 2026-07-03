import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ManualCommerceClient } from "@/lib/connectors/manual-commerce-client";

describe("documented ecommerce API clients", () => {
  it("uses WBuy /order/ resource with GET Bearer apiKey auth and offset,size pagination", async () => {
    // First page returns 100 results (newest-first), second page returns 30
    // results — older than `since`, so the loop must stop after the first page.
    const recentOrders = Array.from({ length: 100 }, (_, idx) => ({
      pedido_id: idx + 1,
      data: "2026-05-10",
      total: "100.00",
    }));
    const olderOrders = Array.from({ length: 30 }, (_, idx) => ({
      pedido_id: 200 + idx,
      data: "2026-04-01",
      total: "50.00",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: recentOrders }))
      .mockResolvedValueOnce(Response.json({ data: olderOrders }));

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.WBUY,
      credentials: {
        apiKey: "Bearer wbuy-token",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      since: "2026-05-01",
      until: "2026-05-18",
    });

    // First request: limit=0,100
    const [url1, init1] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url1.toString()).toBe(
      "https://sistema.sistemawbuy.com.br/api/v1/order?limit=0%2C100",
    );
    expect(init1.headers).toMatchObject({
      Authorization: "Bearer wbuy-token",
      "Content-Type": "application/json",
      "User-Agent": "W3ADS (integracoes@w3educacao.com.br)",
    });
    expect(init1.method).toBe("GET");
    // The page that came back had 100 rows so the loop fetched a second page.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url2] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    expect(url2.toString()).toBe(
      "https://sistema.sistemawbuy.com.br/api/v1/order?limit=100%2C100",
    );

    // Only rows whose `data` is inside the date range are kept.
    expect(orders).toHaveLength(100);
    expect(orders[0]).toMatchObject({ data: "2026-05-10" });
  });

  it("builds WBuy bearer token from API user and password when no token is pasted", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.WBUY,
      credentials: {
        apiUser: "wbuy-user",
        apiPassword: "wbuy-password",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.healthCheck();

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${Buffer.from("wbuy-user:wbuy-password").toString("base64")}`,
      "Content-Type": "application/json",
    });
    expect(init.method).toBe("GET");
  });

  it("normalizes legacy WBuy /orders path and accepts token from API secret", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.WBUY,
      credentials: {
        ordersPath: "/orders",
        apiSecret: "Authorization: Bearer pasted-authorization-token",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.healthCheck();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(
      "https://sistema.sistemawbuy.com.br/api/v1/order?limit=0%2C1",
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer pasted-authorization-token",
      "Content-Type": "application/json",
    });
    expect(init.method).toBe("GET");
  });

  it("tries WBuy slash and Basic auth fallbacks before failing validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.WBUY,
      credentials: {
        ordersPath: "/order",
        apiUser: "wbuy-user",
        apiPassword: "wbuy-password",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.healthCheck();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url1, init1] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    const [url3, init3] = fetchMock.mock.calls[2] as unknown as [
      URL,
      RequestInit,
    ];
    const [, init2] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    const token = Buffer.from("wbuy-user:wbuy-password").toString("base64");
    expect(url1.toString()).toBe(
      "https://sistema.sistemawbuy.com.br/api/v1/order?limit=0%2C1",
    );
    expect(init1.headers).toMatchObject({ Authorization: `Bearer ${token}` });
    expect(init2.headers).toMatchObject({ Authorization: `Basic ${token}` });
    expect(url3.toString()).toBe(
      "https://sistema.sistemawbuy.com.br/api/v1/order/?limit=0%2C1",
    );
    expect(init3.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  it("sends Tray access_token as query parameter instead of generic auth headers", async () => {
    const fetchMock = vi.fn(async () => Response.json({ pedidos: [] }));
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.TRAY,
      credentials: {
        baseUrl: "https://api.tray.com.br",
        apiKey: "tray-token",
        ordersPath: "/orders",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.healthCheck();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.searchParams.get("access_token")).toBe("tray-token");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(init.headers).not.toHaveProperty("X-Api-Key");
  });

  it("uses iSet store ws/v1 base and integration key headers", async () => {
    const fetchMock = vi.fn(async () => Response.json({ pedidos: [] }));
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.ISET,
      credentials: {
        baseUrl: "https://loja.example.com",
        apiKey: "iset-key",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.healthCheck();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toContain("https://loja.example.com/ws/v1/pedidos");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer iset-key",
      "X-Integration-Key": "iset-key",
    });
  });

  it("uses Magazord /api/v2/site/pedido with dataHora[gte/lt] + page pagination and Basic auth", async () => {
    // Magazord wraps the orders array under `{ data: { items: [...] } }`.
    const page1 = Array.from({ length: 100 }, (_, idx) => ({
      id: idx + 1,
      codigo: `PED-${idx + 1}`,
      dataHora: "2026-05-10T10:00:00Z",
    }));
    const page2 = Array.from({ length: 12 }, (_, idx) => ({
      id: 100 + idx + 1,
      codigo: `PED-${100 + idx + 1}`,
      dataHora: "2026-05-11T10:00:00Z",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: "success", data: { items: page1 } }),
      )
      .mockResolvedValueOnce(
        Response.json({ status: "success", data: { items: page2 } }),
      );

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.MAGAZORD,
      credentials: {
        baseUrl: "https://loja.example.com.br",
        apiUser: "usuario",
        apiPassword: "senha",
        apiKey: "token",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      since: "2026-05-01",
      until: "2026-05-18",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url1, init1] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url1.toString()).toContain(
      "https://loja.example.com.br/api/v2/site/pedido",
    );
    // URLSearchParams encodes brackets — verify decoded form.
    expect(url1.searchParams.get("dataHora[gte]")).toBe("2026-05-01");
    expect(url1.searchParams.get("dataHora[lt]")).toBe("2026-05-18");
    expect(url1.searchParams.get("limit")).toBe("100");
    expect(url1.searchParams.get("page")).toBe("1");
    expect(init1.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("usuario:senha").toString("base64")}`,
    });

    const [url2] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    expect(url2.searchParams.get("page")).toBe("2");

    // Combined items across pages, unwrapped from { data: { items: [] } }.
    expect(orders).toHaveLength(112);
    expect(orders[0]).toMatchObject({ codigo: "PED-1" });
    expect(orders[111]).toMatchObject({ codigo: "PED-112" });
  });

  it("reads Google Sheets daily WhatsApp sales from CSV", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          'Calê Joias,,,\nDia,Qtd. Vendas,Valor em vendas,Ticket Médio\n01/05/2026,0,"R$ 0,00",ñ\n02/05/2026,11,"R$ 2.848,75","R$ 258,98"\n,,"R$ 2.848,75",\n',
        ),
    );
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.GOOGLE_SHEETS,
      credentials: {
        baseUrl:
          "https://docs.google.com/spreadsheets/d/14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV/edit?gid=1004138552#gid=1004138552",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      since: "2026-05-01",
      until: "2026-05-18",
    });

    // Tabs are discovered via htmlview first; when it yields no gids the client
    // falls back to the single configured gid — never worse than single-tab.
    const exportCall = (
      fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>
    ).find(([u]) => String(u).includes("/export"));
    expect(String(exportCall?.[0])).toBe(
      "https://docs.google.com/spreadsheets/d/14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV/export?format=csv&gid=1004138552",
    );
    expect(orders).toEqual([
      {
        pedido: "GOOGLE_SHEETS-2026-05-02",
        valor: "R$ 2.848,75",
        status: "APPROVED",
        origem: "whatsapp",
        data: "2026-05-02T00:00:00.000Z",
        qtd_vendas: "11",
        items_count: "11",
      },
    ]);
  });

  it("captures a day with revenue but blank Qtd. Vendas", async () => {
    // Real Calê Joias sheet: 19/06 has a total but no quantity filled — it must
    // still count toward faturamento (was being dropped, ~R$1.344 short).
    const fetchMock = vi.fn(
      async () =>
        new Response(
          'Calê Joias,,,\nDia,Qtd. Vendas,Valor em vendas,Ticket Médio\n19/05/2026,,"R$ 1.344,50",\n',
        ),
    );
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.GOOGLE_SHEETS,
      credentials: {
        baseUrl:
          "https://docs.google.com/spreadsheets/d/14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV/edit?gid=0",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      since: "2026-05-01",
      until: "2026-05-31",
    });

    expect(orders).toEqual([
      {
        pedido: "GOOGLE_SHEETS-2026-05-19",
        valor: "R$ 1.344,50",
        status: "APPROVED",
        origem: "whatsapp",
        data: "2026-05-19T00:00:00.000Z",
        qtd_vendas: "0",
        items_count: "0",
      },
    ]);
  });

  it("ingests every monthly tab discovered via htmlview, not just the configured one", async () => {
    // One tab (gid) per month. htmlview exposes both gids; each CSV export holds
    // that month's daily rows. All months must be ingested (June AND July).
    const juneCsv =
      'Calê Joias,,,\nDia,Qtd. Vendas,Valor em vendas,Ticket Médio\n10/06/2026,3,"R$ 900,00","R$ 300,00"\n';
    const julyCsv =
      'Calê Joias,,,\nDia,Qtd. Vendas,Valor em vendas,Ticket Médio\n05/07/2026,2,"R$ 500,00","R$ 250,00"\n';
    const htmlview =
      '<a href="#gid=1051558490">Junho</a><a href="#gid=2091893132">Julho</a>';

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const href = String(input);
      if (href.includes("/htmlview")) {
        return new Response(htmlview);
      }
      if (href.includes("gid=1051558490")) {
        return new Response(juneCsv);
      }
      if (href.includes("gid=2091893132")) {
        return new Response(julyCsv);
      }
      return new Response("", { status: 404 });
    });

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.GOOGLE_SHEETS,
      credentials: {
        baseUrl:
          "https://docs.google.com/spreadsheets/d/14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV/edit?gid=1051558490",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const orders = await client.listOrders({
      // Range is intentionally narrow — GOOGLE_SHEETS ignores it and ingests all
      // tabs so past months never drop out of the dashboard.
      since: "2026-07-01",
      until: "2026-07-31",
    });

    const pedidos = orders.map((order) => order.pedido).sort();
    expect(pedidos).toEqual([
      "GOOGLE_SHEETS-2026-06-10",
      "GOOGLE_SHEETS-2026-07-05",
    ]);
  });
});
