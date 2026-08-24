import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, publishProdutoToShopeeMock } = vi.hoisted(() => ({
  prismaMock: {
    kit: { findFirst: vi.fn(), update: vi.fn() },
    produto: { findMany: vi.fn() },
    productInventory: { findMany: vi.fn() },
  },
  publishProdutoToShopeeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/publisher/shopee-publish", () => ({
  publishProdutoToShopee: publishProdutoToShopeeMock,
}));

import { publishKitBatch } from "@/lib/kits/publish";

function component(id: string, quantity = 4) {
  return {
    id,
    quantidade: quantity,
    shopeeItemId: `component-${id}`,
    mlItemId: null,
  };
}

function kit(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clienteId: "client-1",
    status: "aprovado",
    shopeeItemId: null,
    produtoId: `derived-${id}`,
    produto: {
      id: `derived-${id}`,
      clienteId: "client-1",
      tituloShopee: `Kit ${id}`,
      descricao: `Descrição ${id}`,
      fotoUrl: `https://img/${id}.jpg`,
      imagens: [],
      categoriaShopeeId: 42,
      preco: 100,
      quantidade: 3,
      shopeeItemId: null,
    },
    proposal: { componentIds: [`${id}-a`, `${id}-b`] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.kit.findFirst.mockResolvedValue(kit("kit-1"));
  prismaMock.produto.findMany.mockResolvedValue([
    component("kit-1-a"),
    component("kit-1-b"),
  ]);
  prismaMock.productInventory.findMany.mockResolvedValue([]);
  prismaMock.kit.update.mockResolvedValue({ id: "kit-1" });
  publishProdutoToShopeeMock.mockResolvedValue({
    produtoId: "derived-kit-1",
    itemId: 12345,
  });
});

describe("publishKitBatch", () => {
  it("publica o Produto derivado e sincroniza o Kit (KPUB-01)", async () => {
    const result = await publishKitBatch({
      kitIds: ["kit-1"],
      workspaceId: "workspace-1",
    });

    expect(result).toEqual({ publicado: 1, erros: [] });
    expect(publishProdutoToShopeeMock).toHaveBeenCalledWith({
      clienteId: "client-1",
      produtoId: "derived-kit-1",
    });
    expect(prismaMock.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1" },
      data: { status: "publicado", shopeeItemId: "12345" },
    });
  });

  it("isola falha de um Kit e continua os demais (KPUB-02)", async () => {
    prismaMock.kit.findFirst
      .mockResolvedValueOnce(kit("kit-1"))
      .mockResolvedValueOnce(kit("kit-2"));
    prismaMock.produto.findMany
      .mockResolvedValueOnce([component("kit-1-a"), component("kit-1-b")])
      .mockResolvedValueOnce([component("kit-2-a"), component("kit-2-b")]);
    publishProdutoToShopeeMock
      .mockRejectedValueOnce(new Error("token secreto expirou"))
      .mockResolvedValueOnce({ produtoId: "derived-kit-2", itemId: 222 });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const result = await publishKitBatch({
        kitIds: ["kit-1", "kit-2"],
        workspaceId: "workspace-1",
      });

      expect(result).toEqual({
        publicado: 1,
        erros: [{ kitId: "kit-1", error: "Falha ao publicar na Shopee." }],
      });
      expect(publishProdutoToShopeeMock).toHaveBeenCalledTimes(2);
      expect(prismaMock.kit.update).toHaveBeenCalledWith({
        where: { id: "kit-1" },
        data: { status: "erro" },
      });
      expect(prismaMock.kit.update).toHaveBeenCalledWith({
        where: { id: "kit-2" },
        data: { status: "publicado", shopeeItemId: "222" },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("revalida estoque e bloqueia sem chamar publisher (KPUB-03)", async () => {
    prismaMock.productInventory.findMany.mockResolvedValueOnce([
      {
        externalProductId: "component-kit-1-b",
        quantity: 1,
        syncedAt: new Date("2026-08-24T12:00:00Z"),
      },
    ]);

    const result = await publishKitBatch({
      kitIds: ["kit-1"],
      workspaceId: "workspace-1",
    });

    expect(result).toEqual({
      publicado: 0,
      erros: [{ kitId: "kit-1", error: "Estoque insuficiente." }],
    });
    expect(prismaMock.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1" },
      data: { status: "bloqueado" },
    });
    expect(publishProdutoToShopeeMock).not.toHaveBeenCalled();
  });

  it("recusa Produto derivado incompleto sem chamar publisher (KPUB-01)", async () => {
    prismaMock.kit.findFirst.mockResolvedValueOnce(
      kit("kit-1", {
        produto: {
          ...kit("kit-1").produto,
          categoriaShopeeId: null,
        },
      }),
    );

    const result = await publishKitBatch({
      kitIds: ["kit-1"],
      workspaceId: "workspace-1",
    });

    expect(result).toEqual({
      publicado: 0,
      erros: [
        { kitId: "kit-1", error: "Produto derivado incompleto para publicação." },
      ],
    });
    expect(publishProdutoToShopeeMock).not.toHaveBeenCalled();
    expect(prismaMock.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1" },
      data: { status: "erro" },
    });
  });

  it("sincroniza retry ja publicado sem criar anuncio duplicado (KPUB-01)", async () => {
    prismaMock.kit.findFirst.mockResolvedValueOnce(
      kit("kit-1", {
        produto: {
          ...kit("kit-1").produto,
          shopeeItemId: "existing-item",
        },
      }),
    );

    const result = await publishKitBatch({
      kitIds: ["kit-1"],
      workspaceId: "workspace-1",
    });

    expect(result).toEqual({ publicado: 1, erros: [] });
    expect(publishProdutoToShopeeMock).not.toHaveBeenCalled();
    expect(prismaMock.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1" },
      data: { status: "publicado", shopeeItemId: "existing-item" },
    });
  });

  it("nao acessa Kit de outro workspace", async () => {
    prismaMock.kit.findFirst.mockResolvedValueOnce(null);

    const result = await publishKitBatch({
      kitIds: ["kit-other"],
      workspaceId: "workspace-1",
    });

    expect(result).toEqual({
      publicado: 0,
      erros: [{ kitId: "kit-other", error: "Kit não encontrado." }],
    });
    expect(prismaMock.kit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "kit-other",
          cliente: { workspaceId: "workspace-1" },
        },
      }),
    );
    expect(publishProdutoToShopeeMock).not.toHaveBeenCalled();
  });
});
