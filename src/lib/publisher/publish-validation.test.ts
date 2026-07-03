import { describe, expect, it } from "vitest";
import type { Produto } from "@prisma/client";

import type { RequiredAttribute } from "./category-attributes";
import { validarPublicavel } from "./publish-validation";

function produto(overrides: Partial<Produto> = {}): Produto {
  return {
    tituloMl: "iPhone 13",
    tituloShopee: "iPhone 13",
    nomeOriginal: "iPhone 13",
    descricao: "desc",
    preco: 3500 as unknown as Produto["preco"],
    quantidade: 5,
    condicao: "new",
    fotoUrl: "https://cdn/x.jpg",
    imagens: ["https://cdn/x.jpg"],
    atributos: { Marca: "Apple" },
    categoriaShopeeId: 123,
    pesoGramas: 200,
    comprimentoCm: 10,
    larguraCm: 8,
    alturaCm: 5,
    ...overrides,
  } as Produto;
}

const brand: RequiredAttribute = {
  id: "BRAND",
  name: "Marca",
  required: true,
  type: "list",
  freeText: false,
  options: [{ id: "9344", name: "Apple" }],
};

describe("validarPublicavel", () => {
  it("ok when everything present (ML)", () => {
    const r = validarPublicavel({
      produto: produto(),
      platform: "ml",
      required: [brand],
    });
    expect(r.ok).toBe(true);
    expect(r.problemas).toHaveLength(0);
  });

  it("flags price/stock/image (ML)", () => {
    const r = validarPublicavel({
      produto: produto({
        preco: 0 as unknown as Produto["preco"],
        quantidade: 0,
        fotoUrl: null,
        imagens: [],
      }),
      platform: "ml",
      required: [],
    });
    const campos = r.problemas.map((p) => p.campo);
    expect(campos).toContain("preco");
    expect(campos).toContain("estoque");
    expect(campos).toContain("imagens");
    expect(r.ok).toBe(false);
  });

  it("flags missing required attribute (enum with no product value)", () => {
    const r = validarPublicavel({
      produto: produto({ atributos: {} }),
      platform: "ml",
      required: [brand],
    });
    expect(r.problemas.some((p) => p.campo === "atributo:BRAND")).toBe(true);
  });

  it("Shopee requires weight + dimensions", () => {
    const r = validarPublicavel({
      produto: produto({
        pesoGramas: null,
        comprimentoCm: null,
        larguraCm: null,
        alturaCm: null,
      }),
      platform: "shopee",
      required: [],
    });
    const campos = r.problemas.map((p) => p.campo);
    expect(campos).toContain("peso");
    expect(campos).toContain("dimensoes");
  });
});
