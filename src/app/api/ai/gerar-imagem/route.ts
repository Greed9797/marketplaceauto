import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { gerarImagem } from "@/lib/publisher/ai-image";
import { resolveAiKey } from "@/lib/publisher/ai-key";
import { fetchImageAsBase64 } from "@/lib/publisher/image-base64";
import {
  requireProdutoInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";
import { uploadProdutoImage } from "@/lib/publisher/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  produtoId: z.string().min(1),
  prompt: z.string().trim().max(1000).optional(),
  /** true = usar a capa atual como base (edição em vez de geração do zero). */
  usarFotoBase: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Dados inválidos." },
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
        cliente: { select: { nicho: true } },
      },
    });
    if (!produto) {
      return NextResponse.json(
        { success: false, error: "Produto não encontrado." },
        { status: 404 },
      );
    }

    const apiKey = await resolveAiKey(guard.workspaceId);
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Configure sua chave Gemini em Configurações para gerar imagens.",
        },
        { status: 400 },
      );
    }

    const nicho = produto.cliente.nicho ? ` para ${produto.cliente.nicho}` : "";
    const prompt =
      parsed.data.prompt?.trim() ||
      `Foto de produto profissional de e-commerce${nicho}: ${produto.nomeOriginal}. Fundo limpo, iluminação de estúdio, alta qualidade, enquadramento quadrado.`;

    const capa = produto.fotoUrl?.trim() || produto.imagens[0] || null;
    const base =
      parsed.data.usarFotoBase && capa ? await fetchImageAsBase64(capa) : null;

    const gerada = await gerarImagem({
      apiKey,
      prompt,
      imagemBase64: base?.base64 ?? null,
      imagemMimeType: base?.mimeType ?? null,
    });

    const url = await uploadProdutoImage({
      workspaceId: guard.workspaceId,
      clienteId: guarded.clienteId,
      buffer: Buffer.from(gerada.base64, "base64"),
      mimeType: gerada.mimeType,
      namePrefix: "ia",
    });

    // Adiciona à galeria do produto (dedup) e define capa se não houver.
    const novasImagens = Array.from(new Set([...produto.imagens, url]));
    await prisma.produto.update({
      where: { id: guarded.produtoId },
      data: {
        imagens: novasImagens,
        ...(produto.fotoUrl ? {} : { fotoUrl: url }),
      },
    });

    return NextResponse.json({ success: true, data: { url } });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Falha ao gerar imagem.";
    console.error(`[api/ai/gerar-imagem] failed: ${message}`);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
