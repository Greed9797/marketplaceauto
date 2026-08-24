import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { classifyBatch } from "@/lib/kits/classify";

export const runtime = "nodejs";

const classifyRequestSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(50),
});

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentUserContext();
    if (
      !canOperateWorkspaceConnectors(
        context.user,
        context.currentMembership.role,
      )
    ) {
      return NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      );
    }

    const json = (await request.json().catch(() => ({}))) as unknown;
    const parsed = classifyRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Limite inválido" },
        { status: 400 },
      );
    }

    const result = await classifyBatch(
      context.currentWorkspace.id,
      parsed.data.limit,
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/kits/classify] batch failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao classificar produtos" },
      { status: 500 },
    );
  }
}
