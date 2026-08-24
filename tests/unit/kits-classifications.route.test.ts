import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  requireClienteInWorkspaceMock,
  requirePublisherWorkspaceMock,
} = vi.hoisted(() => ({
  prismaMock: {
    productClassification: { findMany: vi.fn(), upsert: vi.fn() },
    produto: { findFirst: vi.fn() },
  },
  requireClienteInWorkspaceMock: vi.fn(),
  requirePublisherWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/publisher/route-guard", () => ({
  requireClienteInWorkspace: requireClienteInWorkspaceMock,
  requirePublisherWorkspace: requirePublisherWorkspaceMock,
}));

import { GET, PATCH } from "@/app/api/kits/classifications/route";

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/kits/classifications${query}`);
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/kits/classifications", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const manualBody = {
  produtoId: "product-1",
  gender: "feminino",
  ageBand: "adulto",
  categoryKey: "Vestido",
  colorPattern: "Azul",
};

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
  prismaMock.productClassification.findMany.mockResolvedValue([]);
  prismaMock.produto.findFirst.mockResolvedValue({ id: "product-1" });
  prismaMock.productClassification.upsert.mockResolvedValue({
    produtoId: "product-1",
    gender: "feminino",
    ageBand: "adulto",
    categoryKey: "vestido",
    colorPattern: "Azul",
    confidence: 1,
    source: "manual",
    needsReview: false,
    reviewedAt: new Date("2026-08-24T12:00:00Z"),
  });
});

describe("GET /api/kits/classifications", () => {
  it("nega operador sem permissao (KIT-02, KIT-04)", async () => {
    requirePublisherWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      ),
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(prismaMock.productClassification.findMany).not.toHaveBeenCalled();
  });

  it("lista somente a fila de revisao do workspace (KIT-02)", async () => {
    prismaMock.productClassification.findMany.mockResolvedValueOnce([
      {
        produtoId: "product-1",
        gender: "feminino",
        ageBand: "adulto",
        categoryKey: "vestido",
        colorPattern: null,
        confidence: 0.4,
        source: "ai",
        needsReview: true,
        produto: {
          id: "product-1",
          nomeOriginal: "Vestido azul",
          cliente: { id: "client-1", nome: "Cliente 1" },
        },
      },
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        classifications: [
          expect.objectContaining({
            produtoId: "product-1",
            needsReview: true,
            produto: expect.objectContaining({ nomeOriginal: "Vestido azul" }),
          }),
        ],
      },
    });
    expect(prismaMock.productClassification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          needsReview: true,
          produto: { cliente: { workspaceId: "workspace-1" } },
        },
      }),
    );
  });

  it("impede filtro por cliente cross-workspace", async () => {
    requireClienteInWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Cliente não encontrado" },
        { status: 404 },
      ),
    });

    const response = await GET(getRequest("?clienteId=client-other"));

    expect(response.status).toBe(404);
    expect(prismaMock.productClassification.findMany).not.toHaveBeenCalled();
  });

  it("nao expoe detalhes quando a listagem falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    prismaMock.productClassification.findMany.mockRejectedValueOnce(
      new Error("database secret"),
    );

    try {
      const response = await GET(getRequest());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Falha ao listar classificações",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("PATCH /api/kits/classifications", () => {
  it("nega operador sem permissao antes de editar (KIT-04)", async () => {
    requirePublisherWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      ),
    });

    const response = await PATCH(patchRequest(manualBody));

    expect(response.status).toBe(403);
    expect(prismaMock.produto.findFirst).not.toHaveBeenCalled();
  });

  it("valida todos os atributos antes de persistir (KIT-04)", async () => {
    const response = await PATCH(
      patchRequest({ ...manualBody, gender: "desconhecido" }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.produto.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.productClassification.upsert).not.toHaveBeenCalled();
  });

  it("impede editar produto de outro workspace (KIT-04)", async () => {
    prismaMock.produto.findFirst.mockResolvedValueOnce(null);

    const response = await PATCH(patchRequest(manualBody));

    expect(response.status).toBe(404);
    expect(prismaMock.produto.findFirst).toHaveBeenCalledWith({
      where: {
        id: "product-1",
        cliente: { workspaceId: "workspace-1" },
      },
      select: { id: true },
    });
    expect(prismaMock.productClassification.upsert).not.toHaveBeenCalled();
  });

  it("persiste override manual revisado que a IA nao sobrescreve (KIT-04)", async () => {
    const response = await PATCH(patchRequest(manualBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        classification: expect.objectContaining({
          produtoId: "product-1",
          categoryKey: "vestido",
          source: "manual",
          confidence: 1,
          needsReview: false,
        }),
      },
    });
    expect(prismaMock.productClassification.upsert).toHaveBeenCalledWith({
      where: { produtoId: "product-1" },
      create: expect.objectContaining({
        produtoId: "product-1",
        gender: "feminino",
        ageBand: "adulto",
        categoryKey: "vestido",
        colorPattern: "Azul",
        confidence: 1,
        source: "manual",
        needsReview: false,
        reviewedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        categoryKey: "vestido",
        confidence: 1,
        source: "manual",
        needsReview: false,
        reviewedAt: expect.any(Date),
      }),
      select: expect.any(Object),
    });
  });

  it("nao expoe detalhes quando a edicao falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    prismaMock.productClassification.upsert.mockRejectedValueOnce(
      new Error("database secret"),
    );

    try {
      const response = await PATCH(patchRequest(manualBody));
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Falha ao salvar classificação",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
