import { afterEach, describe, expect, it, vi } from "vitest";

import { gerarCopy } from "@/lib/publisher/ai-copy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const input = {
  cliente: {
    nicho: "moda",
    estiloDescricao: "direto",
    exemplosTitulos: '["Titulo aprovado"]',
    exemplosDescricoes: "Descricao aprovada",
  },
  produto: { nomeOriginal: "Camiseta azul" },
};

describe("gerarCopy", () => {
  it("preserva o retorno normalizado e o prompt multimodal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    titulo_ml: "Titulo ML",
                    titulo_shopee: "Titulo Shopee",
                    descricao: "Descricao",
                    categoria_ml_sugerida: "Camisetas",
                    categoria_shopee_id: 123,
                    atributos: { cor: "azul", tamanho: 42 },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await gerarCopy({
      ...input,
      apiKey: "byok-key",
      imagemBase64: "base64-image",
      imagemMimeType: "image/webp",
    });

    expect(result).toEqual({
      tituloMl: "Titulo ML",
      tituloShopee: "Titulo Shopee",
      descricao: "Descricao",
      categoriaMlSugerida: "Camisetas",
      categoriaShopeeId: 123,
      atributos: { cor: "azul", tamanho: "42" },
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(requestBody.contents[0].parts[0].text).toContain(
      "1. Titulo aprovado",
    );
    expect(requestBody.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/webp", data: "base64-image" },
    });
  });

  it("preserva a mensagem amigavel quando falta chave", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(gerarCopy(input)).rejects.toThrow(
      "Chave de IA não configurada — cadastre sua chave Gemini em Configurações.",
    );
  });

  it("preserva a mensagem de falha HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );

    await expect(gerarCopy({ ...input, apiKey: "byok-key" })).rejects.toThrow(
      "Falha ao gerar copy com Gemini (HTTP 429).",
    );
  });
});
