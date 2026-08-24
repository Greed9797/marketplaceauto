import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { publishKitBatch } from "@/lib/kits/publish";
import { requirePublisherWorkspace } from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

const publishSchema = z
  .object({
    kitIds: z.array(z.string().trim().min(1)).min(1).max(50),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = publishSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Lista de kits inválida" },
        { status: 400 },
      );
    }

    const result = await publishKitBatch({
      kitIds: parsed.data.kitIds,
      workspaceId: guard.workspaceId,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/kits/publish] batch failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao publicar kits" },
      { status: 500 },
    );
  }
}
