import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { buildCopilotSystem } from "@/lib/copilot/context";
import { minimaxChat, type MiniMaxMessage } from "@/lib/copilot/minimax";
import { COPILOT_TOOLS } from "@/lib/copilot/tools";
import { requirePublisherWorkspace } from "@/lib/publisher/route-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  produtoId: z.string().optional().nullable(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * Chat do copiloto (M3). Injeta o contexto do produto + pendências, chama o M3
 * com a whitelist de ferramentas e devolve a resposta em texto e/ou as ações
 * propostas (tool_calls). NÃO executa nada — a execução vai por /apply após o
 * usuário aprovar.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Mensagens inválidas." },
        { status: 400 },
      );
    }

    const system = await buildCopilotSystem({
      workspaceId: guard.workspaceId,
      produtoId: parsed.data.produtoId,
    });

    const messages: MiniMaxMessage[] = [
      ...system,
      ...parsed.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const reply = await minimaxChat({ messages, tools: COPILOT_TOOLS });

    const proposals = reply.toolCalls.map((tc) => {
      let args: unknown = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      return { name: tc.function.name, args };
    });

    return NextResponse.json({
      success: true,
      data: { content: reply.content, proposals },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Falha no copiloto.";
    console.error(`[api/copilot/chat] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
