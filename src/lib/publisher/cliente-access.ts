import { prisma } from "@/lib/db/prisma";

/**
 * Fetches a Cliente only when it belongs to the given workspace. Returns null on
 * miss so callers can reject cross-workspace access (a user could tamper with
 * the `cliente_id` query/cookie value).
 */
export async function resolveClienteForWorkspace(input: {
  clienteId: string;
  workspaceId: string;
}) {
  return prisma.cliente.findFirst({
    where: { id: input.clienteId, workspaceId: input.workspaceId },
  });
}
