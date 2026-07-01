import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import {
  requireProdutoInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateProdutoSchema = z.object({
  nomeOriginal: z.string().trim().min(1, "Nome do produto é obrigatório."),
  fotoUrl: z.string().url().optional().nullable(),
  tituloMl: z.string().trim().max(60).optional().nullable(),
  tituloShopee: z.string().trim().max(120).optional().nullable(),
  descricao: z.string().optional().nullable(),
  categoriaMlId: z.string().optional().nullable(),
  categoriaShopeeId: z.coerce.number().int().positive().optional().nullable(),
  preco: z.coerce.number().positive("Preço deve ser maior que zero."),
  quantidade: z.coerce.number().int().positive().default(1),
  condicao: z.enum(["new", "used", "not_specified"]).default("not_specified"),
  atributos: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const produto = await requireProdutoInWorkspace({
      produtoId: id,
      workspaceId: guard.workspaceId,
    });
    if (!produto.ok) return produto.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = updateProdutoSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        },
        { status: 400 },
      );
    }

    const updated = await prisma.produto.update({
      where: { id: produto.produtoId },
      data: {
        nomeOriginal: parsed.data.nomeOriginal,
        fotoUrl: parsed.data.fotoUrl ?? null,
        tituloMl: parsed.data.tituloMl ?? null,
        tituloShopee: parsed.data.tituloShopee ?? null,
        descricao: parsed.data.descricao ?? null,
        categoriaMlId: parsed.data.categoriaMlId ?? null,
        categoriaShopeeId: parsed.data.categoriaShopeeId ?? null,
        preco: parsed.data.preco,
        quantidade: parsed.data.quantidade,
        condicao: parsed.data.condicao,
        atributos:
          (parsed.data.atributos as Prisma.InputJsonValue | undefined) ??
          undefined,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/produtos/:id] update failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao atualizar produto" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const produto = await requireProdutoInWorkspace({
      produtoId: id,
      workspaceId: guard.workspaceId,
    });
    if (!produto.ok) return produto.response;

    await prisma.produto.delete({ where: { id: produto.produtoId } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/produtos/:id] delete failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao remover produto" },
      { status: 500 },
    );
  }
}
