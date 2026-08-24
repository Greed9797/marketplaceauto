import type { ProductClassification, Produto } from "@prisma/client";
import { z } from "zod";

import { generateJson } from "@/lib/ai/gemini";
import { prisma } from "@/lib/db/prisma";
import { resolveAiKey } from "@/lib/publisher/ai-key";

const classificationSchema = z.object({
  gender: z.enum(["feminino", "masculino", "unissex"]),
  ageBand: z.enum(["adulto", "infantil"]),
  categoryKey: z.string().trim().min(1).transform((value) => value.toLowerCase()),
  colorPattern: z.string().trim().min(1).nullable().optional(),
  confidence: z.number().min(0).max(1),
});

type ProdutoForClassification = Pick<
  Produto,
  | "id"
  | "nomeOriginal"
  | "tituloMl"
  | "tituloShopee"
  | "descricao"
  | "categoriaMlId"
  | "categoriaShopeeId"
  | "atributos"
> & {
  classification?: Pick<ProductClassification, "source"> | null;
};

export type NormalizedClassification = z.infer<typeof classificationSchema> & {
  colorPattern: string | null;
  source: "ai";
  needsReview: boolean;
};

export type ClassificationResult =
  | { status: "classified"; classification: NormalizedClassification }
  | { status: "skipped"; reason: "already_classified" };

export type ClassifyBatchResult = {
  processed: number;
  needsReview: number;
  failures: number;
};

function buildClassificationPrompt(produto: ProdutoForClassification): string {
  const source = {
    nomeOriginal: produto.nomeOriginal,
    tituloMl: produto.tituloMl,
    tituloShopee: produto.tituloShopee,
    descricao: produto.descricao,
    categoriaMlId: produto.categoriaMlId,
    categoriaShopeeId: produto.categoriaShopeeId,
    atributos: produto.atributos,
  };

  return `Classifique este produto de moda para montar kits coerentes.
Use apenas estes valores:
- gender: feminino | masculino | unissex
- ageBand: adulto | infantil
- categoryKey: categoria curta, normalizada e em minusculas
- colorPattern: cor/padrao principal ou null
- confidence: numero entre 0 e 1 para a classificacao completa

Retorne apenas JSON com as cinco chaves acima.
Produto: ${JSON.stringify(source)}`;
}

export async function classifyProduto(
  produto: ProdutoForClassification,
  config: { apiKey?: string | null; model?: string | null },
): Promise<ClassificationResult> {
  if (produto.classification) {
    return { status: "skipped", reason: "already_classified" };
  }

  const { data } = await generateJson<unknown>({
    apiKey: config.apiKey,
    model: config.model,
    prompt: buildClassificationPrompt(produto),
  });
  const parsed = classificationSchema.parse(data);

  return {
    status: "classified",
    classification: {
      ...parsed,
      colorPattern: parsed.colorPattern ?? null,
      source: "ai",
      needsReview: parsed.confidence < 0.7,
    },
  };
}

export async function classifyBatch(
  workspaceId: string,
  limit = 50,
): Promise<ClassifyBatchResult> {
  const take = Math.min(50, Math.max(1, Math.trunc(limit) || 50));
  const [apiKey, produtos] = await Promise.all([
    resolveAiKey(workspaceId),
    prisma.produto.findMany({
      where: {
        cliente: { workspaceId },
        status: "publicado",
        classification: null,
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        nomeOriginal: true,
        tituloMl: true,
        tituloShopee: true,
        descricao: true,
        categoriaMlId: true,
        categoriaShopeeId: true,
        atributos: true,
      },
    }),
  ]);

  const result: ClassifyBatchResult = {
    processed: 0,
    needsReview: 0,
    failures: 0,
  };

  for (const produto of produtos) {
    try {
      const classified = await classifyProduto(produto, { apiKey });
      if (classified.status === "skipped") continue;

      await prisma.productClassification.create({
        data: {
          produtoId: produto.id,
          ...classified.classification,
        },
      });
      result.processed += 1;
      if (classified.classification.needsReview) result.needsReview += 1;
    } catch {
      result.failures += 1;
    }
  }

  return result;
}
