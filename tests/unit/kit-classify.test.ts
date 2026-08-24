import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateJsonMock, prismaMocks, resolveAiKeyMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
  prismaMocks: {
    produto: { findMany: vi.fn() },
    productClassification: { create: vi.fn() },
  },
  resolveAiKeyMock: vi.fn(),
}));

vi.mock("@/lib/ai/gemini", () => ({ generateJson: generateJsonMock }));
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));
vi.mock("@/lib/publisher/ai-key", () => ({
  resolveAiKey: resolveAiKeyMock,
}));

import { classifyBatch, classifyProduto } from "@/lib/kits/classify";

const produto = {
  id: "produto-1",
  nomeOriginal: "Conjunto moletom unissex",
  tituloMl: "Conjunto moletom",
  tituloShopee: null,
  descricao: "Moletom de inverno",
  categoriaMlId: "MLB123",
  categoriaShopeeId: 456,
  atributos: { cor: "cinza" },
};

const highConfidence = {
  gender: "unissex",
  ageBand: "adulto",
  categoryKey: "moletom",
  colorPattern: "cinza",
  confidence: 0.92,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveAiKeyMock.mockResolvedValue("workspace-key");
  prismaMocks.productClassification.create.mockResolvedValue({});
});

describe("classifyProduto", () => {
  it("deriva e normaliza atributos do conteudo do produto (KIT-01)", async () => {
    generateJsonMock.mockResolvedValue({ data: highConfidence, raw: "{}" });

    const result = await classifyProduto(produto, { apiKey: "test-key" });

    expect(result).toEqual({
      status: "classified",
      classification: {
        ...highConfidence,
        source: "ai",
        needsReview: false,
      },
    });
    expect(generateJsonMock.mock.calls[0]![0].prompt).toContain(
      '"nomeOriginal":"Conjunto moletom unissex"',
    );
    expect(generateJsonMock.mock.calls[0]![0].prompt).toContain(
      '"atributos":{"cor":"cinza"}',
    );
  });

  it("marca revisao quando a confianca fica abaixo de 0.7 (KIT-02)", async () => {
    generateJsonMock.mockResolvedValue({
      data: { ...highConfidence, confidence: 0.69 },
      raw: "{}",
    });

    const result = await classifyProduto(produto, { apiKey: "test-key" });

    expect(result).toMatchObject({
      status: "classified",
      classification: { confidence: 0.69, needsReview: true },
    });
  });

  it("preserva classificacao manual sem chamar a IA (KIT-04)", async () => {
    const result = await classifyProduto(
      { ...produto, classification: { source: "manual" } },
      { apiKey: "test-key" },
    );

    expect(result).toEqual({
      status: "skipped",
      reason: "already_classified",
    });
    expect(generateJsonMock).not.toHaveBeenCalled();
  });
});

describe("classifyBatch", () => {
  it("continua o lote apos erro e deixa o item falho para retry (KIT-03)", async () => {
    prismaMocks.produto.findMany.mockResolvedValue([
      produto,
      { ...produto, id: "produto-2", nomeOriginal: "Vestido floral" },
      { ...produto, id: "produto-3", nomeOriginal: "Camiseta infantil" },
    ]);
    generateJsonMock
      .mockResolvedValueOnce({ data: highConfidence, raw: "{}" })
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        data: { ...highConfidence, confidence: 0.5 },
        raw: "{}",
      });

    const result = await classifyBatch("workspace-1");

    expect(result).toEqual({ processed: 2, needsReview: 1, failures: 1 });
    expect(prismaMocks.productClassification.create).toHaveBeenCalledTimes(2);
    expect(prismaMocks.productClassification.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ produtoId: "produto-2" }),
      }),
    );
  });

  it("limita a 50 e busca apenas pendentes em ordem deterministica (KIT-05)", async () => {
    prismaMocks.produto.findMany.mockResolvedValue([]);

    const result = await classifyBatch("workspace-1", 75);

    expect(result).toEqual({ processed: 0, needsReview: 0, failures: 0 });
    expect(prismaMocks.produto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cliente: { workspaceId: "workspace-1" },
          status: "publicado",
          classification: null,
        },
        orderBy: { id: "asc" },
        take: 50,
      }),
    );
  });
});
