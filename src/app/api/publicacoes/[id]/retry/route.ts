import { NextResponse, type NextRequest } from "next/server";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { publishProdutoToMl } from "@/lib/publisher/ml-publish";
import { requirePublisherWorkspace } from "@/lib/publisher/route-guard";
import { publishProdutoToShopee } from "@/lib/publisher/shopee-publish";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;

    // Scope the publicacao to the caller's workspace via produto -> cliente.
    const publicacao = await prisma.publicacao.findFirst({
      where: {
        id,
        produto: { cliente: { workspaceId: guard.workspaceId } },
      },
      select: { id: true, produtoId: true, clienteId: true, plataforma: true },
    });

    if (!publicacao) {
      return NextResponse.json(
        { success: false, error: "Publicação não encontrada." },
        { status: 404 },
      );
    }

    const result =
      publicacao.plataforma === "SHOPEE"
        ? await publishProdutoToShopee({
            clienteId: publicacao.clienteId,
            produtoId: publicacao.produtoId,
          })
        : await publishProdutoToMl({
            clienteId: publicacao.clienteId,
            produtoId: publicacao.produtoId,
          });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao reprocessar publicação.";
    console.error(`[api/publicacoes/:id/retry] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
