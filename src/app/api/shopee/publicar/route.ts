import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { publishProdutoToShopee } from "@/lib/publisher/shopee-publish";
import {
  requireProdutoInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

const schema = z.object({ produtoId: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "produtoId é obrigatório." },
        { status: 400 },
      );
    }

    const produto = await requireProdutoInWorkspace({
      produtoId: parsed.data.produtoId,
      workspaceId: guard.workspaceId,
    });
    if (!produto.ok) return produto.response;

    const result = await publishProdutoToShopee({
      clienteId: produto.clienteId,
      produtoId: produto.produtoId,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao publicar na Shopee.";
    console.error(`[api/shopee/publicar] failed: ${message}`);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
