import { describe, expect, it } from "vitest";

import {
  buildProposals,
  type EngineProduct,
  type KitEngineProposal,
} from "@/lib/kits/engine";

function product(
  id: string,
  overrides: Partial<EngineProduct> = {},
): EngineProduct {
  return {
    id,
    gender: "feminino",
    ageBand: "adulto",
    categoryKey: "camiseta",
    colorPattern: id,
    stock: 10,
    price: 100,
    ...overrides,
  };
}

function hasPair(proposals: KitEngineProposal[], a: string, b: string) {
  const expected = [a, b].sort().join(":");
  return proposals.some(
    (proposal) => [...proposal.componentIds].sort().join(":") === expected,
  );
}

describe("buildProposals", () => {
  it("exige idade igual e genero igual ou unissex (KIT-06)", () => {
    const proposals = buildProposals({
      products: [
        product("feminino"),
        product("masculino", { gender: "masculino" }),
        product("unissex", { gender: "unissex" }),
        product("infantil", { ageBand: "infantil" }),
      ],
      complementaryPairs: [],
    });

    expect(hasPair(proposals, "feminino", "unissex")).toBe(true);
    expect(hasPair(proposals, "masculino", "unissex")).toBe(true);
    expect(hasPair(proposals, "feminino", "masculino")).toBe(false);
    expect(
      proposals.some((proposal) => proposal.componentIds.includes("infantil")),
    ).toBe(false);
  });

  it("aceita homogeneos e apenas pares complementares aprovados (KIT-07)", () => {
    const proposals = buildProposals({
      products: [
        product("camiseta-1"),
        product("camiseta-2"),
        product("bermuda", { categoryKey: "bermuda" }),
        product("vestido", { categoryKey: "vestido" }),
      ],
      complementaryPairs: [
        { categoryA: "camiseta", categoryB: "bermuda", active: true },
        { categoryA: "camiseta", categoryB: "vestido", active: false },
      ],
    });

    expect(hasPair(proposals, "camiseta-1", "camiseta-2")).toBe(true);
    expect(hasPair(proposals, "camiseta-1", "bermuda")).toBe(true);
    expect(hasPair(proposals, "camiseta-1", "vestido")).toBe(false);
    expect(
      proposals.every(
        (proposal) =>
          proposal.componentIds.length >= 2 &&
          proposal.componentIds.length <= 5,
      ),
    ).toBe(true);
  });

  it("descarta qualquer proposta com estoque abaixo do minimo (KIT-08)", () => {
    const proposals = buildProposals({
      products: [
        product("ok-1"),
        product("ok-2"),
        product("baixo", { stock: 1 }),
      ],
      complementaryPairs: [],
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.componentIds).toEqual(["ok-1", "ok-2"]);
  });

  it("aceita razao 1:5 e descarta preco acima dela (KIT-09)", () => {
    const proposals = buildProposals({
      products: [
        product("base", { price: 10 }),
        product("limite", { price: 50 }),
        product("dez-vezes", { price: 100 }),
      ],
      complementaryPairs: [],
    });

    expect(hasPair(proposals, "base", "limite")).toBe(true);
    expect(hasPair(proposals, "base", "dez-vezes")).toBe(false);
  });

  it("explica a camada aplicada e o giro dos componentes (KIT-10)", () => {
    const [proposal] = buildProposals({
      products: [
        product("rapido", { salesVelocity: 20 }),
        product("lento", { salesVelocity: 2 }),
      ],
      complementaryPairs: [],
    });

    expect(proposal!.reason).toContain("homogeneo: camiseta");
    expect(proposal!.reason).toContain(
      "giro: rapido alta saida + lento giro lento",
    );
  });

  it("prioriza cores distintas e sinaliza o monocromatico (KIT-11)", () => {
    const proposals = buildProposals({
      products: [
        product("vermelho-1", { colorPattern: "vermelho" }),
        product("vermelho-2", { colorPattern: "vermelho" }),
        product("azul", { colorPattern: "azul" }),
      ],
      complementaryPairs: [],
    });

    const mono = proposals.find((proposal) =>
      hasPair([proposal], "vermelho-1", "vermelho-2"),
    );
    expect(mono?.monochromatic).toBe(true);
    expect(proposals.at(-1)?.monochromatic).toBe(true);
    expect(proposals[0]?.monochromatic).toBe(false);
  });

  it("ordena primeiro a combinacao de alta saida com giro lento (KIT-12)", () => {
    const proposals = buildProposals({
      products: [
        product("alta", { salesVelocity: 100 }),
        product("media", { salesVelocity: 60 }),
        product("lenta", { salesVelocity: 2 }),
      ],
      complementaryPairs: [],
    });

    expect(proposals[0]!.componentIds).toEqual(["alta", "lenta"]);
    expect(proposals[0]!.turnoverScore).toBe(98);
  });

  it("descarta par duplicado pelo mesmo item externo", () => {
    const proposals = buildProposals({
      products: [
        product("registro-1", { externalItemId: "shopee-1" }),
        product("registro-2", { externalItemId: "shopee-1" }),
      ],
      complementaryPairs: [],
    });

    expect(proposals).toEqual([]);
  });
});
