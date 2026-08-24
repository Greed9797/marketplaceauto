import { describe, expect, it } from "vitest";

import {
  classifyRoasCause,
  stockAction,
  withCause,
} from "@/lib/notifications/causes";

describe("classifyRoasCause (ACTN-01)", () => {
  it("conversao em queda + CTR estavel -> preco/estoque", () => {
    const verdict = classifyRoasCause({
      ctrBaseline: 2,
      ctrRecent: 1.9, // razao 0.95 = estável
      cvrBaseline: 4,
      cvrRecent: 2, // razao 0.5 <= 0.75
    });

    expect(verdict?.cause).toContain("preço");
    expect(verdict?.action).toContain("disponibilidade");
  });

  it("CTR em queda -> criativo/titulo", () => {
    const verdict = classifyRoasCause({
      ctrBaseline: 2,
      ctrRecent: 1.2, // razao 0.6 < 0.85
    });

    expect(verdict?.cause).toBe("queda de CTR");
    expect(verdict?.action).toContain("criativo");
  });

  it("sem sinais -> null mantem recomendacao generica (ACTN-03)", () => {
    expect(classifyRoasCause({})).toBeNull();
    expect(
      classifyRoasCause({ ctrBaseline: 0, cvrBaseline: null }),
    ).toBeNull();
  });
});

describe("stockAction (ACTN-02)", () => {
  it("runway <= 7 dias sugere repor imediatamente", () => {
    expect(stockAction(7)).toBe("repõe o estoque agora");
    expect(stockAction(0)).toBe("repõe o estoque agora");
  });

  it("runway entre 8 e 14 dias sugere programar reposicao", () => {
    expect(stockAction(8)).toBe("programa a reposição ainda esta semana");
    expect(stockAction(14)).toBe("programa a reposição ainda esta semana");
  });

  it("fora da faixa ou sem runway nao sugere nada", () => {
    expect(stockAction(15)).toBeNull();
    expect(stockAction(null)).toBeNull();
  });
});

describe("withCause", () => {
  const base = {
    type: "roas_drop",
    severity: "warning" as const,
    title: "Queda de ROAS",
    body: "ROAS caiu.",
    metadata: { baselineRoas: 10 },
  };

  it("anexa causa e acao no corpo e metadata", () => {
    const enriched = withCause(base, {
      cause: "queda de CTR",
      action: "testar novo criativo",
    });

    expect(enriched.body).toContain("Causa provável: queda de CTR");
    expect(enriched.body).toContain("Ação sugerida: testar novo criativo");
    expect(enriched.metadata).toMatchObject({
      baselineRoas: 10,
      cause: "queda de CTR",
      suggestedAction: "testar novo criativo",
    });
  });

  it("veredito nulo devolve o draft intacto (ACTN-03)", () => {
    expect(withCause(base, null)).toEqual(base);
  });
});
