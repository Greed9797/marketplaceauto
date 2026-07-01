import { NextResponse } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { prisma } from "@/lib/db/prisma";

import { resolveClienteForWorkspace } from "./cliente-access";

export type PublisherGuard =
  | { ok: true; workspaceId: string }
  | { ok: false; response: NextResponse };

/**
 * Shared boundary check for publisher API routes: requires an authenticated
 * user with connector-operate rights and returns their workspace id. On failure
 * returns a ready-to-send `NextResponse` so the caller can early-return.
 */
export async function requirePublisherWorkspace(): Promise<PublisherGuard> {
  const context = await getCurrentUserContext();
  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, workspaceId: context.currentWorkspace.id };
}

/**
 * Resolves a Cliente scoped to the workspace, rejecting cross-workspace access.
 * Returns either the cliente id or a 404 `NextResponse`.
 */
export async function requireClienteInWorkspace(input: {
  clienteId: string;
  workspaceId: string;
}): Promise<
  { ok: true; clienteId: string } | { ok: false; response: NextResponse }
> {
  const cliente = await resolveClienteForWorkspace(input);
  if (!cliente) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Cliente não encontrado" },
        { status: 404 },
      ),
    };
  }

  return { ok: true, clienteId: cliente.id };
}

/**
 * Resolves a Produto and verifies its owning Cliente belongs to the workspace.
 * Returns the produto+cliente ids or a 404 `NextResponse`.
 */
export async function requireProdutoInWorkspace(input: {
  produtoId: string;
  workspaceId: string;
}): Promise<
  | { ok: true; produtoId: string; clienteId: string }
  | { ok: false; response: NextResponse }
> {
  const produto = await prisma.produto.findFirst({
    where: { id: input.produtoId, cliente: { workspaceId: input.workspaceId } },
    select: { id: true, clienteId: true },
  });

  if (!produto) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Produto não encontrado" },
        { status: 404 },
      ),
    };
  }

  return { ok: true, produtoId: produto.id, clienteId: produto.clienteId };
}
