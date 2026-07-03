import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { executeCopilotTool } from "@/lib/copilot/tools";
import { requirePublisherWorkspace } from "@/lib/publisher/route-guard";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  produtoId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
});

/**
 * Executa UMA proposta do copiloto já aprovada pelo usuário. A whitelist e o
 * escopo de workspace são validados dentro de executeCopilotTool.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Requisição inválida." },
        { status: 400 },
      );
    }

    const result = await executeCopilotTool({
      name: parsed.data.name,
      args: parsed.data.args,
      workspaceId: guard.workspaceId,
      produtoId: parsed.data.produtoId,
    });

    return NextResponse.json({
      success: result.ok,
      data: { message: result.message },
      ...(result.ok ? {} : { error: result.message }),
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Falha ao aplicar.";
    console.error(`[api/copilot/apply] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
