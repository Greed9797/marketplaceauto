import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { calcularScore } from "@/lib/publisher/listing-score";
import { publishProdutoToMl } from "@/lib/publisher/ml-publish";
import { publishProdutoToShopee } from "@/lib/publisher/shopee-publish";

import type { MiniMaxTool } from "./minimax";

/**
 * Whitelist de ações que o copiloto pode PROPOR e, após aprovação do usuário,
 * executar (Onda 3+). O modelo M3 só enxerga estas ferramentas; qualquer nome
 * fora daqui é rejeitado no executor. Toda execução é escopada ao workspace.
 */
export const COPILOT_TOOLS: MiniMaxTool[] = [
  {
    type: "function",
    function: {
      name: "atualizar_produto",
      description:
        "Aplica melhorias no anúncio: título ML/Shopee, descrição, categoria, " +
        "preço, estoque, peso/dimensões e atributos da ficha técnica. Use para " +
        "'melhora o título', 'preenche o que falta pra Shopee', etc. Preencha " +
        "SÓ os campos que quer alterar. Sempre inclua 'resumo' explicando a mudança.",
      parameters: {
        type: "object",
        properties: {
          resumo: {
            type: "string",
            description: "Resumo curto, em pt-BR, do que será alterado.",
          },
          tituloMl: { type: "string", description: "Título ML (máx 60)." },
          tituloShopee: {
            type: "string",
            description: "Título Shopee (máx 120).",
          },
          descricao: { type: "string" },
          categoriaMlId: { type: "string", description: "Ex: MLB1234." },
          categoriaShopeeId: { type: "number" },
          preco: { type: "number" },
          quantidade: { type: "number" },
          pesoGramas: { type: "number" },
          comprimentoCm: { type: "number" },
          larguraCm: { type: "number" },
          alturaCm: { type: "number" },
          atributos: {
            type: "object",
            description:
              "Ficha técnica: pares chave→valor. Mescla com os existentes.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["resumo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publicar",
      description:
        "Publica o anúncio no marketplace. Use só quando o anúncio estiver " +
        "pronto (sem pendências).",
      parameters: {
        type: "object",
        properties: {
          plataforma: { type: "string", enum: ["ml", "shopee"] },
        },
        required: ["plataforma"],
      },
    },
  },
];

const atualizarSchema = z.object({
  resumo: z.string().optional(),
  // Trunca no limite do marketplace em vez de rejeitar a proposta da IA.
  tituloMl: z
    .string()
    .transform((s) => s.slice(0, 60))
    .optional(),
  tituloShopee: z
    .string()
    .transform((s) => s.slice(0, 120))
    .optional(),
  descricao: z.string().optional(),
  categoriaMlId: z.string().optional(),
  categoriaShopeeId: z.number().int().positive().optional(),
  preco: z.number().positive().optional(),
  quantidade: z.number().int().positive().optional(),
  pesoGramas: z.number().int().positive().optional(),
  comprimentoCm: z.number().int().positive().optional(),
  larguraCm: z.number().int().positive().optional(),
  alturaCm: z.number().int().positive().optional(),
  atributos: z.record(z.string(), z.string()).optional(),
});

const publicarSchema = z.object({ plataforma: z.enum(["ml", "shopee"]) });

export type CopilotToolResult = { ok: boolean; message: string };

/**
 * Executa UMA ação da whitelist, já aprovada pelo usuário. Escopa o produto ao
 * workspace antes de mutar. Nomes fora da whitelist são rejeitados.
 */
export async function executeCopilotTool(input: {
  name: string;
  args: unknown;
  workspaceId: string;
  produtoId: string;
}): Promise<CopilotToolResult> {
  const produto = await prisma.produto.findFirst({
    where: {
      id: input.produtoId,
      cliente: { workspaceId: input.workspaceId },
    },
  });
  if (!produto) return { ok: false, message: "Produto não encontrado." };

  if (input.name === "atualizar_produto") {
    const parsed = atualizarSchema.safeParse(input.args);
    if (!parsed.success) {
      return { ok: false, message: "Parâmetros inválidos para atualização." };
    }
    const d = parsed.data;
    const atributos = d.atributos
      ? {
          ...((produto.atributos as Record<string, string> | null) ?? {}),
          ...d.atributos,
        }
      : undefined;

    // Estado pós-mudança para recalcular o score determinístico.
    const merged = {
      tituloMl: d.tituloMl ?? produto.tituloMl,
      tituloShopee: d.tituloShopee ?? produto.tituloShopee,
      descricao: d.descricao ?? produto.descricao,
      imagens: produto.imagens,
      fotoUrl: produto.fotoUrl,
      atributos: atributos ?? produto.atributos,
      categoriaMlId: d.categoriaMlId ?? produto.categoriaMlId,
      categoriaShopeeId: d.categoriaShopeeId ?? produto.categoriaShopeeId,
      preco: d.preco ?? Number(produto.preco),
      quantidade: d.quantidade ?? produto.quantidade,
    };
    const { score, breakdown } = calcularScore(merged);

    await prisma.produto.update({
      where: { id: produto.id },
      data: {
        ...(d.tituloMl !== undefined ? { tituloMl: d.tituloMl } : {}),
        ...(d.tituloShopee !== undefined
          ? { tituloShopee: d.tituloShopee }
          : {}),
        ...(d.descricao !== undefined ? { descricao: d.descricao } : {}),
        ...(d.categoriaMlId !== undefined
          ? { categoriaMlId: d.categoriaMlId }
          : {}),
        ...(d.categoriaShopeeId !== undefined
          ? { categoriaShopeeId: d.categoriaShopeeId }
          : {}),
        ...(d.preco !== undefined ? { preco: d.preco } : {}),
        ...(d.quantidade !== undefined ? { quantidade: d.quantidade } : {}),
        ...(d.pesoGramas !== undefined ? { pesoGramas: d.pesoGramas } : {}),
        ...(d.comprimentoCm !== undefined
          ? { comprimentoCm: d.comprimentoCm }
          : {}),
        ...(d.larguraCm !== undefined ? { larguraCm: d.larguraCm } : {}),
        ...(d.alturaCm !== undefined ? { alturaCm: d.alturaCm } : {}),
        ...(atributos ? { atributos: atributos as Prisma.InputJsonValue } : {}),
        score,
        scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      ok: true,
      message: `${d.resumo ?? "Anúncio atualizado."} (score ${score}/100)`,
    };
  }

  if (input.name === "publicar") {
    const parsed = publicarSchema.safeParse(input.args);
    if (!parsed.success) {
      return { ok: false, message: "Plataforma inválida." };
    }
    try {
      if (parsed.data.plataforma === "shopee") {
        await publishProdutoToShopee({
          clienteId: produto.clienteId,
          produtoId: produto.id,
        });
        return { ok: true, message: "Publicado na Shopee." };
      }
      await publishProdutoToMl({
        clienteId: produto.clienteId,
        produtoId: produto.id,
      });
      return { ok: true, message: "Publicado no Mercado Livre." };
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Falha ao publicar.",
      };
    }
  }

  return { ok: false, message: `Ação não permitida: ${input.name}.` };
}
