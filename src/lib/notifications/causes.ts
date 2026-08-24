import type { DeliverableNotification } from "@/lib/notifications/channels";

/**
 * Matriz causa→ação (ACTN-01..03). Sinais ausentes ⇒ recomendação genérica
 * atual é mantida (retorna null). Limiares definidos como premissa na spec:
 * CTR estável quando razão ≥ 0,85; conversão em queda quando razão ≤ 0,75.
 */

export const STABLE_CTR_RATIO = 0.85;
export const CONVERSION_DROP_RATIO = 0.75;

export type RoasCauseSignals = {
  ctrBaseline?: number | null;
  ctrRecent?: number | null;
  /** Taxa de conversão por clique (pedidos ÷ cliques). */
  cvrBaseline?: number | null;
  cvrRecent?: number | null;
};

export type CauseVerdict = { cause: string; action: string };

function ratio(recent?: number | null, baseline?: number | null): number | null {
  if (recent == null || !baseline || baseline <= 0) return null;
  return recent / baseline;
}

/** Linhas da matriz para alertas de ROAS. Null = sinais insuficientes. */
export function classifyRoasCause(
  signals: RoasCauseSignals,
): CauseVerdict | null {
  const ctrRatio = ratio(signals.ctrRecent, signals.ctrBaseline);
  const cvrRatio = ratio(signals.cvrRecent, signals.cvrBaseline);

  const ctrEmQueda =
    ctrRatio !== null && ctrRatio < STABLE_CTR_RATIO ? true : false;
  const ctrEstavel = ctrRatio !== null && ctrRatio >= STABLE_CTR_RATIO;
  const conversaoEmQueda =
    cvrRatio !== null && cvrRatio <= CONVERSION_DROP_RATIO;

  // Queda de conversão com CTR estável -> preço / estoque de variação chave.
  if (conversaoEmQueda && (ctrEstavel || ctrRatio === null)) {
    return {
      cause:
        "queda de conversão com CTR estável — possível aumento de preço ou falta de estoque de variação chave",
      action:
        "confira preço e disponibilidade das variações antes de mexer nos lances",
    };
  }

  // CTR em queda -> criativo / título.
  if (ctrEmQueda) {
    return {
      cause: "queda de CTR",
      action: "teste um novo criativo e revise título e imagem principal",
    };
  }

  return null;
}

/** Sugestão por runway de estoque (ACTN-02). Null fora da faixa útil. */
export function stockAction(runwayDays: number | null | undefined): string | null {
  if (runwayDays == null) return null;
  if (runwayDays <= 7) return "repõe o estoque agora";
  if (runwayDays <= 14) return "programa a reposição ainda esta semana";
  return null;
}

/** Anexa causa provável ao corpo/metadata de um draft quando houver veredito. */
export function withCause<T extends DeliverableNotification>(
  draft: T,
  verdict: CauseVerdict | null,
): T {
  if (!verdict) return draft;
  return {
    ...draft,
    body: `${draft.body ?? ""} Causa provável: ${verdict.cause}. Ação sugerida: ${verdict.action}.`,
    metadata: {
      ...(draft.metadata ?? {}),
      cause: verdict.cause,
      suggestedAction: verdict.action,
    },
  };
}
