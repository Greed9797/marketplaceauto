import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const createClienteSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").max(200),
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

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = createClienteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Nome inválido" },
        { status: 400 },
      );
    }

    const cliente = await prisma.cliente.create({
      data: {
        workspaceId: context.currentWorkspace.id,
        nome: parsed.data.nome,
      },
      select: { id: true, nome: true },
    });

    return NextResponse.json({ success: true, data: cliente }, { status: 201 });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/clientes] create failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao criar cliente" },
      { status: 500 },
    );
  }
}
