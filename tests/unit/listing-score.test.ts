import { describe, expect, test } from "vitest";

import { calcularScore } from "@/lib/publisher/listing-score";

describe("calcularScore", () => {
  test("anúncio vazio = 0", () => {
    const { score, breakdown } = calcularScore({});
    expect(score).toBe(0);
    // toda dica preenchida quando vazio
    expect(breakdown.every((c) => c.dica !== null)).toBe(true);
  });

  test("anúncio completo = 100", () => {
    const { score } = calcularScore({
      tituloMl: "Kit 5 Calças Legging Infantil Menina Algodão Escola",
      descricao: "x".repeat(320),
      imagens: ["a.jpg", "b.jpg", "c.jpg"],
      atributos: {
        marca: "W3",
        material: "Algodão",
        tamanho: "M",
        cor: "Sortido",
        genero: "Feminino",
      },
      categoriaMlId: "MLB1234",
      preco: 79.9,
      quantidade: 10,
    });
    expect(score).toBe(100);
  });

  test("1 imagem dá 10 e sugere adicionar 2", () => {
    const { breakdown } = calcularScore({ imagens: ["a.jpg"] });
    const img = breakdown.find((c) => c.criterio === "Imagens");
    expect(img?.pontos).toBe(10);
    expect(img?.dica).toContain("mais 2");
  });

  test("fotoUrl conta como imagem e dedup com galeria", () => {
    const { breakdown } = calcularScore({
      fotoUrl: "a.jpg",
      imagens: ["a.jpg", "b.jpg", "c.jpg"],
    });
    // 3 únicas (a dedupada) → 20 pontos
    expect(breakdown.find((c) => c.criterio === "Imagens")?.pontos).toBe(20);
  });

  test("título longo demais perde os 8 de comprimento", () => {
    const { breakdown } = calcularScore({ tituloMl: "x".repeat(80) });
    const t = breakdown.find((c) => c.criterio === "Título");
    expect(t?.pontos).toBe(12);
    expect(t?.dica).toContain("Título longo");
  });

  test("atributos parciais pontuam proporcional", () => {
    const { breakdown } = calcularScore({
      atributos: { marca: "W3", cor: "Azul" },
    });
    expect(breakdown.find((c) => c.criterio === "Ficha técnica")?.pontos).toBe(
      8,
    );
  });

  test("categoria Shopee numérica conta", () => {
    const { breakdown } = calcularScore({ categoriaShopeeId: 100123 });
    expect(breakdown.find((c) => c.criterio === "Categoria")?.pontos).toBe(10);
  });
});
