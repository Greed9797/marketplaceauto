import { prisma } from "@/lib/db/prisma";
import { calcularScore } from "@/lib/publisher/listing-score";
import { previewPublishMl } from "@/lib/publisher/ml-publish";
import { previewPublishShopee } from "@/lib/publisher/shopee-publish";

import { buildCopilotSystem } from "./context";
import { minimaxChat } from "./minimax";
import { COPILOT_TOOLS, executeCopilotTool } from "./tools";

/**
 * Eval harness do copiloto (gerador↔avaliador). O GERADOR (M3) melhora o
 * anúncio; o AVALIADOR (harness de qualidade) pontua 0–100 + feedback; o loop
 * repete até passar o limiar/publicável ou esgotar as rodadas. Auto-aplica só
 * `atualizar_produto` (conteúdo, reversível) — nunca publica.
 */

export type HarnessEvaluation = {
  score: number;
  publicavel: boolean;
  feedback: string[];
};

export type HarnessRound = {
  n: number;
  score: number;
  publicavel: boolean;
  feedback: string[];
  applied: string[];
};

export type HarnessReport = {
  rounds: HarnessRound[];
  finalScore: number;
  publicavel: boolean;
  converged: boolean;
};

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_THRESHOLD = 85;

/** Combina completude determinística com o juízo do M3. Puro (testável). */
export function combineScore(
  completude: number,
  juizM3: number | null,
): number {
  if (juizM3 === null) return Math.round(clamp0100(completude));
  return Math.round(0.5 * clamp0100(completude) + 0.5 * clamp0100(juizM3));
}

/** Condição de parada do loop. Pura (testável). */
export function shouldStop(input: {
  score: number;
  publicavel: boolean;
  threshold: number;
}): boolean {
  return input.score >= input.threshold && input.publicavel;
}

function clamp0100(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Juiz de copy via M3 (1 call, sem tools). Best-effort → null se falhar. */
async function judgeCopy(input: {
  nome: string;
  tituloMl: string | null;
  tituloShopee: string | null;
  descricao: string | null;
}): Promise<{ score: number; feedback: string[] } | null> {
  try {
    const reply = await minimaxChat({
      messages: [
        {
          role: "system",
          content:
            "Você avalia a QUALIDADE de copy de anúncio de marketplace BR. " +
            'Responda APENAS JSON: {"score": 0-100, "feedback": ["..."]}. ' +
            "Penalize título genérico, sem palavra-chave, descrição curta/vazia.",
        },
        {
          role: "user",
          content: `Produto: ${input.nome}
Título ML: ${input.tituloMl ?? "(vazio)"}
Título Shopee: ${input.tituloShopee ?? "(vazio)"}
Descrição: ${input.descricao ? input.descricao.slice(0, 500) : "(vazia)"}`,
        },
      ],
    });
    const clean = reply.content
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "");
    const parsed: unknown = JSON.parse(clean);
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    const score = clamp0100(Number(rec.score ?? 0));
    const feedback = Array.isArray(rec.feedback)
      ? rec.feedback.map((f) => String(f)).filter(Boolean)
      : [];
    return { score, feedback };
  } catch {
    return null;
  }
}

/** Avaliador: completude + publicável + juízo do M3 → score/feedback. */
export async function evaluateListing(input: {
  produtoId: string;
  workspaceId: string;
}): Promise<HarnessEvaluation> {
  const produto = await prisma.produto.findFirst({
    where: {
      id: input.produtoId,
      cliente: { workspaceId: input.workspaceId },
    },
  });
  if (!produto) {
    return {
      score: 0,
      publicavel: false,
      feedback: ["Produto não encontrado."],
    };
  }

  const [ml, shopee] = await Promise.all([
    previewPublishMl({ clienteId: produto.clienteId, produto }).catch(
      () => null,
    ),
    previewPublishShopee({ clienteId: produto.clienteId, produto }).catch(
      () => null,
    ),
  ]);

  // Publicável = há ao menos 1 plataforma conectada e todas as conectadas ok.
  const conectadas = [ml, shopee].filter((p): p is NonNullable<typeof p> =>
    Boolean(p?.connected),
  );
  const publicavel =
    conectadas.length > 0 &&
    conectadas.every((p) => p.alreadyPublished || p.validation.ok);

  const pendencias = conectadas.flatMap((p) =>
    p.validation.ok
      ? []
      : p.validation.problemas.map(
          (x) => `${p.platform === "ml" ? "ML" : "Shopee"}: ${x.mensagem}`,
        ),
  );

  // Score real: ancorado nos atributos obrigatórios da categoria + gate.
  const requiredAttrNames = [
    ...new Set(
      conectadas.flatMap((p) =>
        p.requiredAttributes.filter((a) => a.required).map((a) => a.name),
      ),
    ),
  ];
  const { score: completude, breakdown } = calcularScore(
    {
      tituloMl: produto.tituloMl,
      tituloShopee: produto.tituloShopee,
      descricao: produto.descricao,
      imagens: produto.imagens,
      fotoUrl: produto.fotoUrl,
      atributos: produto.atributos,
      categoriaMlId: produto.categoriaMlId,
      categoriaShopeeId: produto.categoriaShopeeId,
      preco: Number(produto.preco),
      quantidade: produto.quantidade,
    },
    { requiredAttrNames, publicavel, pendencias },
  );

  const juiz = await judgeCopy({
    nome: produto.nomeOriginal,
    tituloMl: produto.tituloMl,
    tituloShopee: produto.tituloShopee,
    descricao: produto.descricao,
  });

  const dicas = breakdown
    .filter((c) => c.pontos < c.max && c.dica)
    .map((c) => c.dica!)
    .slice(0, 5);

  return {
    score: combineScore(completude, juiz?.score ?? null),
    publicavel,
    feedback: [...pendencias, ...(juiz?.feedback ?? []), ...dicas],
  };
}

/** Gerador: M3 propõe atualizar_produto a partir do feedback; auto-aplica. */
async function generateRound(input: {
  produtoId: string;
  workspaceId: string;
  feedback: string[];
}): Promise<string[]> {
  const system = await buildCopilotSystem({
    workspaceId: input.workspaceId,
    produtoId: input.produtoId,
  });
  const reply = await minimaxChat({
    messages: [
      ...system,
      {
        role: "user",
        content:
          "Melhore este anúncio ao MÁXIMO de qualidade e deixe-o publicável. " +
          "Chame atualizar_produto preenchendo todos os campos que faltam. " +
          "Feedback da avaliação atual:\n- " +
          (input.feedback.join("\n- ") || "nenhum"),
      },
    ],
    tools: COPILOT_TOOLS,
  });

  const applied: string[] = [];
  for (const tc of reply.toolCalls) {
    if (tc.function.name !== "atualizar_produto") continue; // nunca publica
    let args: unknown = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch {
      continue;
    }
    const result = await executeCopilotTool({
      name: "atualizar_produto",
      args,
      workspaceId: input.workspaceId,
      produtoId: input.produtoId,
    });
    if (result.ok) applied.push(result.message);
  }
  return applied;
}

/** Loop do harness: avaliar → gerar → aplicar até passar ou esgotar. */
export async function runHarness(input: {
  produtoId: string;
  workspaceId: string;
  maxRounds?: number;
  threshold?: number;
}): Promise<HarnessReport> {
  const maxRounds = clamp(input.maxRounds ?? DEFAULT_MAX_ROUNDS, 1, 6);
  const threshold = clamp(input.threshold ?? DEFAULT_THRESHOLD, 50, 100);
  const rounds: HarnessRound[] = [];

  for (let n = 1; n <= maxRounds; n++) {
    const ev = await evaluateListing(input);
    const round: HarnessRound = {
      n,
      score: ev.score,
      publicavel: ev.publicavel,
      feedback: ev.feedback,
      applied: [],
    };
    rounds.push(round);

    if (shouldStop({ score: ev.score, publicavel: ev.publicavel, threshold })) {
      break;
    }

    const applied = await generateRound({
      produtoId: input.produtoId,
      workspaceId: input.workspaceId,
      feedback: ev.feedback,
    });
    round.applied = applied;
    if (applied.length === 0) break; // convergiu / gerador travou
  }

  const final = await evaluateListing(input);
  return {
    rounds,
    finalScore: final.score,
    publicavel: final.publicavel,
    converged: shouldStop({
      score: final.score,
      publicavel: final.publicavel,
      threshold,
    }),
  };
}
