import { NextResponse, type NextRequest } from "next/server";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { diagnoseWorkspace } from "@/lib/copilot/diagnose";
import { requirePublisherWorkspace } from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

/** Copiloto: diagnóstico read-only do workspace (Onda 3). Não muta nada. */
export async function GET(_request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const issues = await diagnoseWorkspace(guard.workspaceId);
    return NextResponse.json({ success: true, data: { issues } });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Falha ao diagnosticar.";
    console.error(`[api/copilot/diagnose] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
