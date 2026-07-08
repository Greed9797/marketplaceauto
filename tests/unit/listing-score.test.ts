import { describe, expect, test } from "vitest";

import { calcularScore } from "@/lib/publisher/listing-score";

const anuncioBom = {
  tituloMl: "Kit 5 Calças Legging Infantil Menina Algodão Escola",
  descricao: "x".repeat(320),
  imagens: ["a.jpg", "b.jpg", "c.jpg"],
  atributos: { Marca: "W3", Material: "Algodão", Tamanho: "M" },
  categoriaMlId: "MLB1234",
  preco: 79.9,
  quantidade: 10,
};

describe("calcularScore", () => {
  test("anúncio vazio = 0 e todas as dicas preenchidas", () => {
    const { score, breakdown } = calcularScore({});
    expect(score).toBe(0);
    expect(breakdown.every((c) => c.dica !== null)).toBe(true);
  });

  test("sem requisitos reais NÃO chega a 100 (não engana o usuário)", () => {
    const { score, breakdown } = calcularScore(anuncioBom);
    expect(score).toBeLessThan(100);
    // O gate real "Pronto para publicar" fica 0 sem preview.
    const pub = breakdown.find((c) => c.criterio === "Pronto para publicar");
    expect(pub?.pontos).toBe(0);
    expect(pub?.dica).toContain("otimização");
  });

  test("100 só com atributos obrigatórios cobertos + gate verde", () => {
    const { score } = calcularScore(anuncioBom, {
      requiredAttrNames: ["Marca", "Material"],
      publicavel: true,
      pendencias: [],
    });
    expect(score).toBe(100);
  });

  test("atributo obrigatório faltando derruba a cobertura e lista o que falta", () => {
    const { breakdown } = calcularScore(
      { ...anuncioBom, atributos: { Marca: "W3" } },
      {
        requiredAttrNames: ["Marca", "Material"],
        publicavel: false,
        pendencias: ["Shopee: peso obrigatório"],
      },
    );
    const attr = breakdown.find((c) => c.criterio === "Atributos obrigatórios");
    expect(attr?.pontos).toBe(13); // 25 * 1/2 arredondado
    expect(attr?.dica).toContain("Material");
    const pub = breakdown.find((c) => c.criterio === "Pronto para publicar");
    expect(pub?.pontos).toBe(0);
    expect(pub?.dica).toContain("peso");
  });

  test("categoria sem atributos obrigatórios = cobertura completa", () => {
    const { breakdown } = calcularScore(anuncioBom, {
      requiredAttrNames: [],
      publicavel: true,
      pendencias: [],
    });
    expect(
      breakdown.find((c) => c.criterio === "Atributos obrigatórios")?.pontos,
    ).toBe(25);
  });

  test("1 imagem dá 8 e sugere adicionar 2", () => {
    const { breakdown } = calcularScore({ imagens: ["a.jpg"] });
    const img = breakdown.find((c) => c.criterio === "Imagens");
    expect(img?.pontos).toBe(8);
    expect(img?.dica).toContain("mais 2");
  });

  test("fotoUrl dedup com galeria conta como 3 imagens = 15", () => {
    const { breakdown } = calcularScore({
      fotoUrl: "a.jpg",
      imagens: ["a.jpg", "b.jpg", "c.jpg"],
    });
    expect(breakdown.find((c) => c.criterio === "Imagens")?.pontos).toBe(15);
  });
});
