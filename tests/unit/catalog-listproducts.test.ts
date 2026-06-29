import { describe, expect, it, vi } from "vitest";

import { NuvemshopClient } from "@/lib/connectors/nuvemshop/client";
import { ShopifyClient } from "@/lib/connectors/shopify/client";

describe("NuvemshopClient.listProducts", () => {
  it("sums variant stock, picks a SKU and resolves the i18n category", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 42,
            name: { pt: "Vaso Cerâmica" },
            categories: [{ id: 1, name: { pt: "Decoração" } }],
            variants: [
              { sku: "VASO-P", stock: 3 },
              { sku: "VASO-G", stock: 5 },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(Response.json([]));

    const client = new NuvemshopClient({
      config: {
        clientId: "c",
        clientSecret: "s",
        redirectUri: "https://app/cb",
        apiBaseUrl: "https://api.nuvemshop.com.br/v1",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      storeId: "100",
      accessToken: "tok",
    });

    expect(rows).toEqual([
      {
        externalProductId: "42",
        sku: "VASO-P",
        productName: "Vaso Cerâmica",
        categoryName: "Decoração",
        quantity: 8,
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/100/products");
  });

  it("reports null quantity when the store does not track stock (unlimited)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 7,
            name: { pt: "Perfume Importado" },
            categories: [{ id: 1, name: { pt: "Nicho" } }],
            variants: [{ sku: "PERF-1", stock: null, stock_management: false }],
          },
        ]),
      )
      .mockResolvedValueOnce(Response.json([]));

    const client = new NuvemshopClient({
      config: {
        clientId: "c",
        clientSecret: "s",
        redirectUri: "https://app/cb",
        apiBaseUrl: "https://api.nuvemshop.com.br/v1",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      storeId: "100",
      accessToken: "tok",
    });

    expect(rows[0]).toMatchObject({
      productName: "Perfume Importado",
      quantity: null,
    });
  });

  it("picks the most specific (leaf) category over a broad parent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 9,
            name: { pt: "BDK Ambre" },
            categories: [
              {
                id: 10,
                name: { pt: "Nicho" },
                parent: null,
                subcategories: [20],
              },
              {
                id: 20,
                name: { pt: "BDK Parfums" },
                parent: 10,
                subcategories: [],
              },
            ],
            variants: [{ sku: "BDK-1", stock: 4 }],
          },
        ]),
      )
      .mockResolvedValueOnce(Response.json([]));

    const client = new NuvemshopClient({
      config: {
        clientId: "c",
        clientSecret: "s",
        redirectUri: "https://app/cb",
        apiBaseUrl: "https://api.nuvemshop.com.br/v1",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      storeId: "100",
      accessToken: "tok",
    });

    expect(rows[0]?.categoryName).toBe("BDK Parfums");
  });

  it("treats a 404 past the last page as end-of-pagination, not an error", async () => {
    // A full first page (200) makes the loop request page 2, which Nuvemshop
    // answers with 404 "Last page is 1". That must end pagination gracefully.
    const fullPage = Array.from({ length: 200 }, (_unused, index) => ({
      id: index + 1,
      name: { pt: `Produto ${index + 1}` },
      categories: [{ id: 1, name: { pt: "Geral" } }],
      variants: [{ sku: `SKU-${index + 1}`, stock: 1 }],
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(fullPage))
      .mockResolvedValueOnce(
        Response.json({ code: 404, message: "Last page is 1" }, { status: 404 }),
      );

    const client = new NuvemshopClient({
      config: {
        clientId: "c",
        clientSecret: "s",
        redirectUri: "https://app/cb",
        apiBaseUrl: "https://api.nuvemshop.com.br/v1",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      storeId: "100",
      accessToken: "tok",
    });

    expect(rows).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("ShopifyClient.listProducts", () => {
  const config = {
    apiVersion: "2026-04",
    apiKey: "k",
    apiSecret: "s",
    redirectUri: "https://app/cb",
    scopes: "read_products,read_inventory",
  };

  it("maps productType to category and sums variant inventory", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: {
          products: {
            edges: [
              {
                cursor: "c1",
                node: {
                  id: "gid://shopify/Product/1",
                  title: "Suculenta",
                  productType: "Plantas",
                  variants: {
                    edges: [
                      { node: { sku: "SUC-1", inventoryQuantity: 10 } },
                      { node: { sku: "SUC-2", inventoryQuantity: 2 } },
                    ],
                  },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    );

    const client = new ShopifyClient({
      config,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      shop: "teststore",
      accessToken: "tok",
    });

    expect(rows).toEqual([
      {
        externalProductId: "gid://shopify/Product/1",
        sku: "SUC-1",
        productName: "Suculenta",
        categoryName: "Plantas",
        quantity: 12,
      },
    ]);
  });

  it("falls back to category-only when the token lacks read_inventory", async () => {
    const fetchMock = vi
      .fn()
      // First call (with inventoryQuantity) is denied for missing scope.
      .mockResolvedValueOnce(
        Response.json({
          errors: [
            {
              message: "Access denied for inventoryQuantity field",
              extensions: { code: "ACCESS_DENIED" },
            },
          ],
        }),
      )
      // Retry without inventoryQuantity succeeds (category-only).
      .mockResolvedValueOnce(
        Response.json({
          data: {
            products: {
              edges: [
                {
                  cursor: "c1",
                  node: {
                    id: "gid://shopify/Product/2",
                    title: "Cacto",
                    productType: "Plantas",
                    variants: { edges: [{ node: { sku: "CAC-1" } }] },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      );

    const client = new ShopifyClient({
      config,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      shop: "teststore",
      accessToken: "tok",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({
      productName: "Cacto",
      categoryName: "Plantas",
      quantity: 0, // no inventory scope → stock degrades to 0
    });
  });

  it("reports null quantity for variants Shopify does not track", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        data: {
          products: {
            edges: [
              {
                cursor: "c1",
                node: {
                  id: "gid://shopify/Product/3",
                  title: "Vela Aromática",
                  productType: "Casa",
                  variants: {
                    edges: [
                      {
                        node: {
                          sku: "VELA-1",
                          inventoryQuantity: 0,
                          inventoryItem: { tracked: false },
                        },
                      },
                    ],
                  },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    );

    const client = new ShopifyClient({
      config,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rows = await client.listProducts({
      shop: "teststore",
      accessToken: "tok",
    });

    expect(rows[0]).toMatchObject({
      productName: "Vela Aromática",
      quantity: null,
    });
  });
});
