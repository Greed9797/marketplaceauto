import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildProposalsMock, prismaMocks } = vi.hoisted(() => ({
  buildProposalsMock: vi.fn(),
  prismaMocks: {
    cliente: { findUnique: vi.fn() },
    produto: { findMany: vi.fn() },
    complementaryPair: { findMany: vi.fn() },
    productInventory: { findMany: vi.fn() },
    ecommerceOrderItem: { groupBy: vi.fn() },
    kitProposal: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));
vi.mock("@/lib/kits/engine", () => ({ buildProposals: buildProposalsMock }));

import { buildComboHash, generateProposals } from "@/lib/kits/proposals";

const products = [
  {
    id: "produto-a",
    nomeOriginal: "Camiseta",
    tituloMl: null,
    tituloShopee: "Camiseta",
    mlItemId: null,
    shopeeItemId: "item-a",
    preco: 100,
    quantidade: 9,
    classification: {
      gender: "feminino",
      ageBand: "adulto",
      categoryKey: "camiseta",
      colorPattern: "azul",
    },
  },
  {
    id: "produto-b",
    nomeOriginal: "Bermuda",
    tituloMl: null,
    tituloShopee: "Bermuda",
    mlItemId: null,
    shopeeItemId: "item-b",
    preco: 80,
    quantidade: 8,
    classification: {
      gender: "feminino",
      ageBand: "adulto",
      categoryKey: "bermuda",
      colorPattern: "preto",
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.cliente.findUnique.mockResolvedValue({
    workspaceId: "workspace-1",
  });
  prismaMocks.produto.findMany.mockResolvedValue(products);
  prismaMocks.complementaryPair.findMany.mockResolvedValue([
    { categoryA: "camiseta", categoryB: "bermuda", active: true },
  ]);
  prismaMocks.productInventory.findMany.mockResolvedValue([
    { externalProductId: "item-a", sku: "SKU-A", quantity: 4 },
    { externalProductId: "item-b", sku: "SKU-B", quantity: 3 },
  ]);
  prismaMocks.ecommerceOrderItem.groupBy.mockResolvedValue([
    { sku: "SKU-A", _sum: { quantity: 20 } },
    { sku: "SKU-B", _sum: { quantity: 2 } },
  ]);
  prismaMocks.kitProposal.findMany.mockResolvedValue([]);
  prismaMocks.kitProposal.createMany.mockResolvedValue({ count: 1 });
  buildProposalsMock.mockReturnValue([
    {
      componentIds: ["produto-b", "produto-a"],
      reason: "par complementar: bermuda+camiseta; giro",
      monochromatic: false,
      turnoverScore: 18,
    },
  ]);
});

describe("buildComboHash", () => {
  it("produz o mesmo SHA-256 independente da ordem", () => {
    const forward = buildComboHash(["produto-a", "produto-b"]);
    const reverse = buildComboHash(["produto-b", "produto-a"]);

    expect(reverse).toBe(forward);
    expect(forward).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("generateProposals", () => {
  it("carrega estoque e giro, executa o engine e persiste proposta canonica (KIT-12)", async () => {
    const created = await generateProposals("cliente-1");

    expect(created).toBe(1);
    expect(buildProposalsMock).toHaveBeenCalledWith({
      products: [
        expect.objectContaining({
          id: "produto-a",
          stock: 4,
          salesVelocity: 20,
          externalItemId: "item-a",
        }),
        expect.objectContaining({
          id: "produto-b",
          stock: 3,
          salesVelocity: 2,
          externalItemId: "item-b",
        }),
      ],
      complementaryPairs: [
        { categoryA: "camiseta", categoryB: "bermuda", active: true },
      ],
    });
    expect(prismaMocks.produto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clienteId: "cliente-1",
          status: "publicado",
          classification: { is: { needsReview: false } },
        }),
      }),
    );
    expect(prismaMocks.kitProposal.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          clienteId: "cliente-1",
          componentIds: ["produto-a", "produto-b"],
          comboHash: buildComboHash(["produto-a", "produto-b"]),
          status: "proposta",
          monochromatic: false,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("nao recria combinacao rejeitada (KIT-14)", async () => {
    prismaMocks.kitProposal.findMany.mockResolvedValue([
      { comboHash: buildComboHash(["produto-a", "produto-b"]) },
    ]);

    const created = await generateProposals("cliente-1");

    expect(created).toBe(0);
    expect(prismaMocks.kitProposal.createMany).not.toHaveBeenCalled();
  });

  it("usa quantidade publicada quando nao existe estoque ao vivo", async () => {
    prismaMocks.productInventory.findMany.mockResolvedValue([]);

    await generateProposals("cliente-1");

    expect(buildProposalsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          expect.objectContaining({ id: "produto-a", stock: 9 }),
          expect.objectContaining({ id: "produto-b", stock: 8 }),
        ],
      }),
    );
    expect(prismaMocks.ecommerceOrderItem.groupBy).not.toHaveBeenCalled();
  });
});
