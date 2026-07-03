import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { gerarCopy } from "@/lib/publisher/ai-copy";
import { resolveAiKey } from "@/lib/publisher/ai-key";
import { fetchImageAsBase64 } from "@/lib/publisher/image-base64";
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

    const guarded = await requireProdutoInWorkspace({
      produtoId: parsed.data.produtoId,
      workspaceId: guard.workspaceId,
    });
    if (!guarded.ok) return guarded.response;

    const produto = await prisma.produto.findUnique({
      where: { id: guarded.produtoId },
      select: {
        nomeOriginal: true,
        fotoUrl: true,
        imagens: true,
        cliente: {
          select: {
            nicho: true,
            estiloDescricao: true,
            exemplosTitulos: true,
            exemplosDescricoes: true,
          },
        },
      },
    });

    if (!produto) {
      return NextResponse.json(
        { success: false, error: "Produto não encontrado." },
        { status: 404 },
      );
    }

    const apiKey = await resolveAiKey(guard.workspaceId);
    const capa = produto.fotoUrl?.trim() || produto.imagens[0] || null;
    const imagem = capa ? await fetchImageAsBase64(capa) : null;

    const copy = await gerarCopy({
      cliente: produto.cliente,
      produto: { nomeOriginal: produto.nomeOriginal },
      apiKey,
      imagemBase64: imagem?.base64 ?? null,
      imagemMimeType: imagem?.mimeType ?? null,
    });

    return NextResponse.json({ success: true, data: copy });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao gerar copy com Gemini.";
    console.error(`[api/ai/gerar-copy] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
