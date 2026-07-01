import { PublisherPlatform } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

async function readClienteId(request: NextRequest): Promise<string | null> {
  const queryValue = request.nextUrl.searchParams.get("cliente_id");
  if (queryValue) {
    return queryValue;
  }
  const body = (await request.json().catch(() => null)) as {
    cliente_id?: unknown;
  } | null;
  return typeof body?.cliente_id === "string" ? body.cliente_id : null;
}

export async function DELETE(request: NextRequest) {
  try {
    const clienteId = await readClienteId(request);
    if (!clienteId) {
      return NextResponse.json(
        { success: false, error: "cliente_id é obrigatório" },
        { status: 400 },
      );
    }

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

    const cliente = await resolveClienteForWorkspace({
      clienteId,
      workspaceId: context.currentWorkspace.id,
    });
    if (!cliente) {
      return NextResponse.json(
        { success: false, error: "Cliente não encontrado" },
        { status: 404 },
      );
    }

    await prisma.clienteConnection.deleteMany({
      where: {
        clienteId: cliente.id,
        platform: PublisherPlatform.MERCADO_LIVRE,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[auth/ml/disconnect] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao desconectar" },
      { status: 500 },
    );
  }
}
