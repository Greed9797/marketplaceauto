import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { gerarCopy } from "@/lib/publisher/ai-copy";
import {
  getRequiredAttributes,
  type RequiredAttribute,
} from "@/lib/publisher/category-attributes";
import { resolveAiKey } from "@/lib/publisher/ai-key";
import { fetchImageAsBase64 } from "@/lib/publisher/image-base64";
import {
  requireProdutoInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

const schema = z.object({ produtoId: z.string().min(1) });

/**
 * Resolve os atributos obrigatórios da categoria ML sugerida pelo título.
 * Usa apenas endpoints públicos do ML (recommendCategory + fetchCategoryAttributes),
 * então dispensa token. Falha silenciosa → retorna [] (copy segue sem steer).
 */
async function resolveMlRequiredAttributes(
  titulo: string,
): Promise<RequiredAttribute[]> {
  try {
    const client = new MercadoLivreClient({ config: null });
    const suggestion = await client.recommendCategory(titulo);
    if (!suggestion?.categoryId) return [];
    return await getRequiredAttributes({
      platform: "ml",
      client,
      categoryId: suggestion.categoryId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[gerar-copy] resolveMlRequiredAttributes: ${message}`);
    return [];
  }
}

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

    // Fase 1.4: resolve a categoria ML (endpoints públicos, sem token) e busca
    // os atributos obrigatórios para a IA preenchê-los. Best-effort — se a
    // resolução falhar, a copy é gerada mesmo assim (sem steer de atributos).
    const requiredAttributes = await resolveMlRequiredAttributes(
      produto.nomeOriginal,
    );

    const copy = await gerarCopy({
      cliente: produto.cliente,
      produto: { nomeOriginal: produto.nomeOriginal },
      apiKey,
      imagemBase64: imagem?.base64 ?? null,
      imagemMimeType: imagem?.mimeType ?? null,
      requiredAttributes,
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
