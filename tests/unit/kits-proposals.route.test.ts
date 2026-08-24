import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureDerivedProdutoMock,
  prismaMock,
  requireClienteInWorkspaceMock,
  requirePublisherWorkspaceMock,
} = vi.hoisted(() => ({
  ensureDerivedProdutoMock: vi.fn(),
  prismaMock: {
    kitProposal: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    produto: { findMany: vi.fn() },
    productInventory: { findMany: vi.fn() },
    kit: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  requireClienteInWorkspaceMock: vi.fn(),
  requirePublisherWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/kits/derived-product", () => ({
  ensureDerivedProduto: ensureDerivedProdutoMock,
}));
vi.mock("@/lib/publisher/route-guard", () => ({
  requireClienteInWorkspace: requireClienteInWorkspaceMock,
  requirePublisherWorkspace: requirePublisherWorkspaceMock,
}));

import { GET, PATCH } from "@/app/api/kits/proposals/route";

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/kits/proposals${query}`);
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/kits/proposals", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    clienteId: "client-1",
    componentIds: ["product-1", "product-2"],
    reason: "homogeneo: camiseta; giro indisponivel",
    monochromatic: false,
    status: "proposta",
    cliente: { id: "client-1", nome: "Cliente 1" },
    kit: null,
    ...overrides,
  };
}

function product(id: string, quantidade = 3) {
  return {
    id,
    clienteId: "client-1",
    nomeOriginal: `Produto ${id}`,
    fotoUrl: null,
    imagens: [],
    preco: 50,
    quantidade,
    shopeeItemId: `shopee-${id}`,
    mlItemId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePublisherWorkspaceMock.mockResolvedValue({
    ok: true,
    workspaceId: "workspace-1",
  });
  requireClienteInWorkspaceMock.mockResolvedValue({
    ok: true,
    clienteId: "client-1",
  });
  prismaMock.kitProposal.findMany.mockResolvedValue([]);
  prismaMock.produto.findMany.mockResolvedValue([]);
  prismaMock.productInventory.findMany.mockResolvedValue([]);
  prismaMock.kitProposal.update.mockResolvedValue({ id: "proposal-1" });
  prismaMock.kit.upsert.mockResolvedValue({
    id: "kit-1",
    status: "aprovado",
    price: 100,
  });
  ensureDerivedProdutoMock.mockResolvedValue({
    id: "derived-1",
    categoriaShopeeId: null,
  });
  prismaMock.$transaction.mockImplementation(
    async (callback: (client: typeof prismaMock) => unknown) =>
      callback(prismaMock),
  );
});

describe("GET /api/kits/proposals", () => {
  it("nega operador sem permissao (KIT-16)", async () => {
    requirePublisherWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      ),
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(prismaMock.kitProposal.findMany).not.toHaveBeenCalled();
  });

  it("lista somente propostas do workspace com status normalizado (KIT-16)", async () => {
    prismaMock.kitProposal.findMany.mockResolvedValueOnce([proposal()]);
    prismaMock.produto.findMany.mockResolvedValueOnce([
      product("product-1"),
      product("product-2"),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        proposals: [
          expect.objectContaining({
            id: "proposal-1",
            status: "proposta",
            suggestedPrice: 100,
            components: [
              expect.objectContaining({ id: "product-1", price: 50 }),
              expect.objectContaining({ id: "product-2", price: 50 }),
            ],
          }),
        ],
      },
    });
    expect(prismaMock.kitProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cliente: { workspaceId: "workspace-1" },
        }),
      }),
    );
  });

  it("expoe produto derivado para revisao no editor (KIT-13)", async () => {
    prismaMock.kitProposal.findMany.mockResolvedValueOnce([
      proposal({
        status: "aprovada",
        kit: {
          id: "kit-1",
          status: "aprovado",
          price: 100,
          produtoId: "derived-1",
          produto: { categoriaShopeeId: null },
        },
      }),
    ]);
    prismaMock.produto.findMany.mockResolvedValueOnce([
      product("product-1"),
      product("product-2"),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        proposals: [
          expect.objectContaining({
            status: "aprovado",
            kit: expect.objectContaining({
              produtoId: "derived-1",
              categoryPending: true,
            }),
          }),
        ],
      },
    });
  });

  it("valida filtro e impede cliente cross-workspace (KIT-16)", async () => {
    requireClienteInWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Cliente não encontrado" },
        { status: 404 },
      ),
    });

    const crossTenant = await GET(getRequest("?clienteId=client-other"));
    const invalidStatus = await GET(getRequest("?status=qualquer"));

    expect(crossTenant.status).toBe(404);
    expect(invalidStatus.status).toBe(400);
    expect(prismaMock.kitProposal.findMany).not.toHaveBeenCalled();
  });

  it("nao expoe detalhes em erro 500", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    prismaMock.kitProposal.findMany.mockRejectedValueOnce(
      new Error("database secret"),
    );

    try {
      const response = await GET(getRequest());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Falha ao listar propostas",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("PATCH /api/kits/proposals", () => {
  it("nega operador sem permissao antes da decisao (KIT-13, KIT-14)", async () => {
    requirePublisherWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      ),
    });

    const response = await PATCH(
      patchRequest({ action: "reject", proposalId: "proposal-1" }),
    );

    expect(response.status).toBe(403);
    expect(prismaMock.kitProposal.findFirst).not.toHaveBeenCalled();
  });

  it("rejeita input invalido sem consultar proposta", async () => {
    const response = await PATCH(
      patchRequest({ action: "approve", proposalId: "proposal-1", price: 0 }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.kitProposal.findFirst).not.toHaveBeenCalled();
  });

  it("impede acesso a proposta de outro workspace", async () => {
    prismaMock.kitProposal.findFirst.mockResolvedValueOnce(null);

    const response = await PATCH(
      patchRequest({ action: "reject", proposalId: "proposal-other" }),
    );

    expect(response.status).toBe(404);
    expect(prismaMock.kitProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "proposal-other",
          cliente: { workspaceId: "workspace-1" },
        },
      }),
    );
  });

  it("aprova e persiste Kit 1:1 com preco informado (KIT-13)", async () => {
    prismaMock.kitProposal.findFirst.mockResolvedValueOnce(proposal());
    prismaMock.produto.findMany.mockResolvedValueOnce([
      product("product-1"),
      product("product-2"),
    ]);
    prismaMock.kit.upsert.mockResolvedValueOnce({
      id: "kit-1",
      status: "aprovado",
      price: 129.9,
    });

    const response = await PATCH(
      patchRequest({
        action: "approve",
        proposalId: "proposal-1",
        price: 129.9,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        kit: {
          id: "kit-1",
          status: "aprovado",
          price: 129.9,
          produtoId: "derived-1",
          categoryPending: true,
        },
      },
    });
    expect(prismaMock.kit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { proposalId: "proposal-1" },
        create: expect.objectContaining({
          proposalId: "proposal-1",
          clienteId: "client-1",
          price: 129.9,
          status: "aprovado",
        }),
      }),
    );
    expect(ensureDerivedProdutoMock).toHaveBeenCalledWith({
      kitId: "kit-1",
      workspaceId: "workspace-1",
    });
  });

  it("bloqueia Kit quando componente esta abaixo do estoque minimo (KIT-15)", async () => {
    prismaMock.kitProposal.findFirst.mockResolvedValueOnce(proposal());
    prismaMock.produto.findMany.mockResolvedValueOnce([
      product("product-1"),
      product("product-2"),
    ]);
    prismaMock.productInventory.findMany.mockResolvedValueOnce([
      {
        externalProductId: "shopee-product-2",
        quantity: 1,
        syncedAt: new Date("2026-08-24T12:00:00Z"),
      },
    ]);
    prismaMock.kit.upsert.mockResolvedValueOnce({
      id: "kit-1",
      status: "bloqueado",
      price: 100,
    });

    const response = await PATCH(
      patchRequest({
        action: "approve",
        proposalId: "proposal-1",
        price: 100,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        kit: {
          id: "kit-1",
          status: "bloqueado",
          price: 100,
          produtoId: "derived-1",
          categoryPending: true,
        },
      },
    });
    expect(prismaMock.kit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "bloqueado" }),
        update: expect.objectContaining({ status: "bloqueado" }),
      }),
    );
  });

  it("registra rejeicao definitiva sem criar Kit (KIT-14)", async () => {
    prismaMock.kitProposal.findFirst.mockResolvedValueOnce(proposal());
    prismaMock.kitProposal.update.mockResolvedValueOnce({
      id: "proposal-1",
      status: "rejeitada",
    });

    const response = await PATCH(
      patchRequest({ action: "reject", proposalId: "proposal-1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { proposal: { id: "proposal-1", status: "rejeitada" } },
    });
    expect(prismaMock.kitProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { status: "rejeitada" },
      select: { id: true, status: true },
    });
    expect(prismaMock.kit.upsert).not.toHaveBeenCalled();
  });

  it("nao expoe detalhes quando a decisao falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    prismaMock.kitProposal.findFirst.mockRejectedValueOnce(
      new Error("database secret"),
    );

    try {
      const response = await PATCH(
        patchRequest({ action: "reject", proposalId: "proposal-1" }),
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Falha ao atualizar proposta",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
