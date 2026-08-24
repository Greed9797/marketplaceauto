import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    kit: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    produto: {
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    productInventory: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

import { ensureDerivedProduto } from "@/lib/kits/derived-product";

function component(input: {
  id: string;
  name: string;
  category?: number | null;
  quantity?: number;
  fotoUrl?: string | null;
  imagens?: string[];
}) {
  return {
    id: input.id,
    clienteId: "client-1",
    nomeOriginal: input.name,
    tituloShopee: null,
    descricao: null,
    fotoUrl: input.fotoUrl ?? null,
    imagens: input.imagens ?? [],
    categoriaShopeeId: input.category ?? null,
    preco: 50,
    quantidade: input.quantity ?? 4,
    shopeeItemId: `shopee-${input.id}`,
    mlItemId: null,
  };
}

function kit(produto: Record<string, unknown> | null = null) {
  return {
    id: "kit-1",
    clienteId: "client-1",
    price: 129.9,
    produto,
    proposal: { componentIds: ["product-1", "product-2"] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.kit.findFirst.mockResolvedValue(kit());
  prismaMock.kit.findUnique.mockResolvedValue({
    produtoId: null,
    produto: null,
  });
  prismaMock.produto.findMany.mockResolvedValue([
    component({
      id: "product-1",
      name: "Camiseta azul",
      category: 42,
      fotoUrl: "https://img/blue-cover.jpg",
      imagens: [
        "https://img/blue-cover.jpg",
        "https://img/blue-extra.jpg",
      ],
    }),
    component({
      id: "product-2",
      name: "Camiseta branca",
      category: 42,
      fotoUrl: "https://img/white-cover.jpg",
    }),
  ]);
  prismaMock.productInventory.findMany.mockResolvedValue([
    {
      externalProductId: "shopee-product-1",
      quantity: 5,
      syncedAt: new Date("2026-08-24T12:00:00Z"),
    },
    {
      externalProductId: "shopee-product-2",
      quantity: 3,
      syncedAt: new Date("2026-08-24T12:00:00Z"),
    },
  ]);
  prismaMock.produto.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "derived-1",
      ...data,
    }),
  );
  prismaMock.kit.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.$transaction.mockImplementation(
    async (callback: (client: typeof prismaMock) => unknown) =>
      callback(prismaMock),
  );
});

describe("ensureDerivedProduto", () => {
  it("cria rascunho deterministico com preco, estoque e categoria comuns (KIT-13, KPUB-01)", async () => {
    const result = await ensureDerivedProduto({
      kitId: "kit-1",
      workspaceId: "workspace-1",
    });

    expect(result).toEqual(
      expect.objectContaining({ id: "derived-1", origem: "kit" }),
    );
    expect(prismaMock.produto.create).toHaveBeenCalledWith({
      data: {
        clienteId: "client-1",
        nomeOriginal: "Kit Camiseta azul + Camiseta branca",
        tituloShopee: "Kit Camiseta azul + Camiseta branca",
        descricao:
          "Kit composto por:\n- Camiseta azul\n- Camiseta branca",
        fotoUrl: "https://img/blue-cover.jpg",
        imagens: [
          "https://img/blue-cover.jpg",
          "https://img/blue-extra.jpg",
          "https://img/white-cover.jpg",
        ],
        status: "rascunho",
        origem: "kit",
        categoriaShopeeId: 42,
        preco: 129.9,
        quantidade: 3,
      },
    });
    expect(prismaMock.kit.updateMany).toHaveBeenCalledWith({
      where: { id: "kit-1", produtoId: null },
      data: { produtoId: "derived-1" },
    });
  });

  it("reutiliza o Produto ja relacionado sem duplicar no retry (KIT-13)", async () => {
    const existing = { id: "derived-existing", origem: "kit" };
    prismaMock.kit.findFirst.mockResolvedValueOnce(kit(existing));

    const result = await ensureDerivedProduto({
      kitId: "kit-1",
      workspaceId: "workspace-1",
    });

    expect(result).toEqual(existing);
    expect(prismaMock.produto.findMany).not.toHaveBeenCalled();
    expect(prismaMock.produto.create).not.toHaveBeenCalled();
  });

  it("deixa categoria pendente quando componentes divergem (KPUB-01)", async () => {
    prismaMock.produto.findMany.mockResolvedValueOnce([
      component({ id: "product-1", name: "Camiseta", category: 42 }),
      component({ id: "product-2", name: "Bermuda", category: 99 }),
    ]);

    await ensureDerivedProduto({
      kitId: "kit-1",
      workspaceId: "workspace-1",
    });

    expect(prismaMock.produto.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ categoriaShopeeId: null }),
    });
  });

  it("deixa categoria pendente quando algum componente nao tem categoria (KPUB-01)", async () => {
    prismaMock.produto.findMany.mockResolvedValueOnce([
      component({ id: "product-1", name: "Camiseta", category: 42 }),
      component({ id: "product-2", name: "Bermuda", category: null }),
    ]);

    await ensureDerivedProduto({
      kitId: "kit-1",
      workspaceId: "workspace-1",
    });

    expect(prismaMock.produto.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ categoriaShopeeId: null }),
    });
  });

  it("recusa componentes fora do cliente/workspace antes de criar", async () => {
    prismaMock.produto.findMany.mockResolvedValueOnce([
      component({ id: "product-1", name: "Camiseta", category: 42 }),
    ]);

    await expect(
      ensureDerivedProduto({
        kitId: "kit-1",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Componentes do kit não encontrados");
    expect(prismaMock.produto.create).not.toHaveBeenCalled();
  });
});
