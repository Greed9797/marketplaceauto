import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { normalizeLojaIntegradaInventory } from "@/lib/connectors/inventory";
import { ManualCommerceClient } from "@/lib/connectors/manual-commerce-client";
import { buildDashboardSnapshot } from "@/lib/metrics/aggregator";
import { getDashboardPeriod } from "@/lib/metrics/period";

describe("normalizeLojaIntegradaInventory", () => {
  it("reads a flat stock quantity", () => {
    expect(
      normalizeLojaIntegradaInventory({
        id: 10,
        nome: "Perfume X",
        sku: "PX-100",
        quantidade: "7",
      }),
    ).toEqual({
      externalProductId: "10",
      sku: "PX-100",
      productName: "Perfume X",
      categoryName: null,
      quantity: 7,
    });
  });

  it("normalizes a WBuy product (produto/categoria_level1/estoque[])", () => {
    // Real WBuy /product shape: name under `produto`, category under
    // categoria_levelN.nome, stock summed across the `estoque[]` variations.
    expect(
      normalizeLojaIntegradaInventory({
        id: "12345",
        produto: "Adesivo Decorativo",
        cod: "ADS-001",
        categoria_level1: { id: "9", nome: "Adesivos", url: "adesivos" },
        categoria_level2: { id: "0", nome: "" },
        estoque: [
          { sku: "ADS-001-P", quantidade_em_estoque: "7" },
          { sku: "ADS-001-G", quantidade_em_estoque: "3" },
        ],
      }),
    ).toEqual({
      externalProductId: "12345",
      sku: "ADS-001",
      productName: "Adesivo Decorativo",
      categoryName: "Adesivos",
      quantity: 10,
    });
  });

  it("extracts the category name when present", () => {
    const row = normalizeLojaIntegradaInventory({
      id: 20,
      nome: "Perfume W",
      sku: "PW-1",
      quantidade: 4,
      categoria: "Perfumaria",
    });
    expect(row?.categoryName).toBe("Perfumaria");
  });

  it("extracts category from a nested object / list shape", () => {
    expect(
      normalizeLojaIntegradaInventory({
        id: 21,
        nome: "Item A",
        categorias: [{ nome: "Casa" }],
      })?.categoryName,
    ).toBe("Casa");
    expect(
      normalizeLojaIntegradaInventory({
        id: 22,
        nome: "Item B",
        categoria: { nome: "Jardim" },
      })?.categoryName,
    ).toBe("Jardim");
  });

  it("ignores category ids/URIs (needs a name, not an id)", () => {
    const row = normalizeLojaIntegradaInventory({
      id: 23,
      nome: "Item C",
      categorias: ["/api/v1/categoria/5/"],
    });
    expect(row?.categoryName).toBeNull();
  });

  it("reads a nested estoque.quantidade", () => {
    const row = normalizeLojaIntegradaInventory({
      id: 11,
      nome: "Perfume Y",
      estoque: { quantidade: 3 },
    });
    expect(row?.quantity).toBe(3);
  });

  it("defaults quantity to 0 when stock is absent", () => {
    const row = normalizeLojaIntegradaInventory({ id: 12, nome: "Perfume Z" });
    expect(row?.quantity).toBe(0);
  });

  it("returns null without an id or name", () => {
    expect(normalizeLojaIntegradaInventory({ quantidade: 5 })).toBeNull();
  });
});

describe("ManualCommerceClient.listInventory (Loja Integrada)", () => {
  it("paginates /produto/search/ and maps stock rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          meta: { next: "/api/v1/produto/search/?offset=100" },
          objects: Array.from({ length: 100 }, (_, idx) => ({
            id: idx + 1,
            nome: `Produto ${idx + 1}`,
            quantidade: 2,
          })),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          meta: { next: null },
          objects: [{ id: 101, nome: "Produto 101", quantidade: 9 }],
        }),
      );

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.LOJA_INTEGRADA,
      credentials: { apiKey: "k", apiSecret: "s" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listInventory();
    expect(rows).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url1 = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url1.pathname).toBe("/v1/produto/search/");
    expect(url1.searchParams.get("limit")).toBe("100");
    expect(rows[100]).toMatchObject({
      productName: "Produto 101",
      quantity: 9,
    });
  });

  it("returns [] for providers without a catalog source", async () => {
    const client = new ManualCommerceClient({
      provider: ConnectorProvider.ISET,
      credentials: { apiKey: "Bearer t" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(await client.listInventory()).toEqual([]);
  });
});

describe("ManualCommerceClient.listInventory (WBuy / Magazord / Tray)", () => {
  it("pulls WBuy catalog with stock and category", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: 7,
              nome: "Camiseta",
              sku: "CAM-1",
              estoque: 15,
              categorias: [{ nome: "Vestuário" }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: [] }));

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.WBUY,
      credentials: { apiKey: "Bearer t" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listInventory();
    expect(rows).toEqual([
      {
        externalProductId: "7",
        sku: "CAM-1",
        productName: "Camiseta",
        categoryName: "Vestuário",
        quantity: 15,
      },
    ]);
  });

  it("pulls Magazord catalog from /api/v2/site/produto", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: {
          items: [
            {
              id: 3,
              nome: "Tênis",
              sku: "TEN-1",
              saldo: 4,
              categoria: "Calçados",
            },
          ],
        },
      }),
    );

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.MAGAZORD,
      credentials: { baseUrl: "https://x.magazord.com.br", apiKey: "t" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listInventory();
    expect(rows[0]).toMatchObject({
      productName: "Tênis",
      categoryName: "Calçados",
      quantity: 4,
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v2/site/produto");
  });

  it("unwraps Tray's { Products: [{ Product }] } shape", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        Products: [
          {
            Product: {
              id: 99,
              name: "Caneca",
              reference: "CAN-1",
              stock: "8",
              ProductCategory: { Category: { name: "Cozinha" } },
            },
          },
        ],
      }),
    );

    const client = new ManualCommerceClient({
      provider: ConnectorProvider.TRAY,
      credentials: { baseUrl: "https://x.commercesuite.com.br", apiKey: "tok" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listInventory();
    expect(rows[0]).toMatchObject({
      externalProductId: "99",
      sku: "CAN-1",
      productName: "Caneca",
      categoryName: "Cozinha",
      quantity: 8,
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("access_token")).toBe("tok");
  });
});

describe("dashboard products join inventory", () => {
  it("fills stockQuantity from inventory by product name", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [],
      orderItems: [
        {
          productName: "Perfume X",
          categoryName: "Perfumes",
          quantity: 4,
          total: "400.00",
          status: "pago",
          placedAt: new Date("2026-05-10T12:00:00.000Z"),
        },
      ],
      inventory: [
        { productName: "perfume x", quantity: 5 },
        { productName: "Perfume X", quantity: 2 },
      ],
    });

    const product = snapshot.products.find(
      (p) => p.productName === "Perfume X",
    );
    // Case-insensitive match, summed across connectors (5 + 2).
    expect(product?.stockQuantity).toBe(7);
  });

  it("matches stock by SKU even when the product name has a variant suffix", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [],
      orderItems: [
        {
          productName: "Rosa do Deserto - TROPICAL",
          sku: "ROSA-1",
          categoryName: null,
          quantity: 3,
          total: "300.00",
          status: "pago",
          placedAt: new Date("2026-05-10T12:00:00.000Z"),
        },
      ],
      // Catalog name differs ("Rosa do Deserto"), only SKU lines up.
      inventory: [
        {
          productName: "Rosa do Deserto",
          sku: "ROSA-1",
          quantity: 12,
          categoryName: "Suculentas",
        },
      ],
    });

    const product = snapshot.products.find(
      (p) => p.productName === "Rosa do Deserto - TROPICAL",
    );
    expect(product?.stockQuantity).toBe(12);
    // Category enriched from the catalog by SKU → not "Sem categoria".
    const category = snapshot.categories.find(
      (c) => c.categoryName === "Suculentas",
    );
    expect(category?.quantitySold).toBe(3);
  });

  it("falls back to 'Sem categoria' only when no catalog category matches", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [],
      orderItems: [
        {
          productName: "Produto Sem Cat",
          sku: "X-9",
          categoryName: null,
          quantity: 2,
          total: "20.00",
          status: "pago",
          placedAt: new Date("2026-05-10T12:00:00.000Z"),
        },
      ],
      inventory: [],
    });
    expect(snapshot.categories[0]?.categoryName).toBe("Sem categoria");
  });

  it("leaves stockQuantity null when no inventory matches", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [],
      orderItems: [
        {
          productName: "Sem Estoque",
          categoryName: null,
          quantity: 1,
          total: "10.00",
          status: "pago",
          placedAt: new Date("2026-05-10T12:00:00.000Z"),
        },
      ],
      inventory: [],
    });
    expect(snapshot.products[0]?.stockQuantity).toBeNull();
  });
});
