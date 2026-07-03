import { NextResponse, type NextRequest } from "next/server";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { previewPublishMl } from "@/lib/publisher/ml-publish";
import {
  requireProdutoInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";
import type { PublishPreview } from "@/lib/publisher/publish-validation";
import { previewPublishShopee } from "@/lib/publisher/shopee-publish";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Preview read-only de publicação (Fase 1.7): para cada plataforma retorna o
 * checklist do gate + atributos obrigatórios da categoria, para a UI mostrar o
 * que falta e habilitar "Publicar". NÃO publica nem muta o produto. Cada
 * plataforma é resolvida de forma independente — falha em uma não derruba a
 * outra (retorna preview desconectado).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const guarded = await requireProdutoInWorkspace({
      produtoId: id,
      workspaceId: guard.workspaceId,
    });
    if (!guarded.ok) return guarded.response;

    const produto = await prisma.produto.findFirst({
      where: { id: guarded.produtoId, clienteId: guarded.clienteId },
    });
    if (!produto) {
      return NextResponse.json(
        { success: false, error: "Produto não encontrado." },
        { status: 404 },
      );
    }

    const [ml, shopee] = await Promise.all([
      previewPublishMl({ clienteId: guarded.clienteId, produto }).catch(
        (): PublishPreview => disconnectedPreview("ml"),
      ),
      previewPublishShopee({ clienteId: guarded.clienteId, produto }).catch(
        (): PublishPreview => disconnectedPreview("shopee"),
      ),
    ]);

    return NextResponse.json({ success: true, data: { ml, shopee } });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Falha ao validar publicação.";
    console.error(`[api/produtos/[id]/publicar-preview] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

function disconnectedPreview(platform: "ml" | "shopee"): PublishPreview {
  return {
    platform,
    connected: false,
    categoryResolved: false,
    alreadyPublished: false,
    requiredAttributes: [],
    validation: { ok: false, problemas: [] },
  };
}
