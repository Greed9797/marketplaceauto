import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { runHarness } from "@/lib/copilot/harness";
import {
  requireProdutoInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  produtoId: z.string().min(1),
  maxRounds: z.number().int().min(1).max(6).optional(),
  threshold: z.number().int().min(50).max(100).optional(),
});

/**
 * Eval harness do copiloto (Onda 3+): loop gerador↔avaliador que otimiza o
 * anúncio automaticamente (auto-aplica só conteúdo, nunca publica). Retorna o
 * relatório rodada-a-rodada.
 */
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

    const report = await runHarness({
      produtoId: guarded.produtoId,
      workspaceId: guard.workspaceId,
      maxRounds: parsed.data.maxRounds,
      threshold: parsed.data.threshold,
    });

    return NextResponse.json({ success: true, data: report });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Falha no harness.";
    console.error(`[api/copilot/harness] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
