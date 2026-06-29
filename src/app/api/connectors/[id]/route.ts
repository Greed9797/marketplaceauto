import { ConnectorStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canDeleteWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { prisma } from "@/lib/db/prisma";
import { getSecretStore } from "@/lib/security/secret-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const userContext = await getCurrentUserContext();

  if (
    !canDeleteWorkspaceConnectors(
      userContext.user,
      userContext.currentMembership.role,
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const account = await prisma.connectorAccount.findUnique({
    where: { id },
    select: {
      id: true,
      workspaceId: true,
      provider: true,
      accountName: true,
      status: true,
      credentialSecretId: true,
      refreshCredentialSecretId: true,
    },
  });

  if (!account) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  // The connected-accounts table only lists the active workspace, so a removal
  // always targets a connector in the workspace the user is currently viewing.
  if (account.workspaceId !== userContext.currentWorkspace.id) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  // Idempotent: a connector already revoked is treated as successfully removed.
  if (account.status === ConnectorStatus.REVOKED) {
    return NextResponse.json({ ok: true });
  }

  // Best-effort: drop the Vault secrets first. A Vault failure must NOT block
  // removing the connector row, so failures here are logged and swallowed.
  const store = getSecretStore();
  const secretIds = [
    account.credentialSecretId,
    account.refreshCredentialSecretId,
  ].filter((value): value is string => Boolean(value));
  for (const secretId of secretIds) {
    try {
      await store.deleteSecret(secretId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error(
        `[connectors/${id}] vault secret cleanup failed (${secretId}): ${message}`,
      );
    }
  }

  try {
    // Soft delete: flip to REVOKED and invalidate the stored credentials instead
    // of hard-deleting. A hard delete cascades (ON DELETE CASCADE) into orders,
    // daily metrics and sync jobs, wiping the workspace's historical facts. The
    // sync orchestrator only picks up ACTIVE accounts, so a REVOKED row stops
    // syncing; reconnecting upserts the same unique row back to ACTIVE with
    // fresh tokens, preserving all child history.
    await prisma.connectorAccount.update({
      where: { id: account.id },
      data: {
        status: ConnectorStatus.REVOKED,
        // Credential ciphertext columns are NOT NULL — blank them to guarantee
        // the revoked tokens can never be decrypted/used.
        accessTokenCiphertext: "",
        refreshTokenCiphertext: null,
        tokenIv: "",
        tokenAuthTag: "",
        credentialSecretId: null,
        refreshCredentialSecretId: null,
        tokenExpiresAt: null,
        lastSyncError: null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown";
    // Log the raw cause server-side; never return Prisma internals (table /
    // column / constraint names) to the client.
    console.error(`[connectors/${id}] revoke failed: ${message}`);
    return NextResponse.json(
      {
        ok: false,
        error: "delete_failed",
        message: "Erro ao remover conector. Tente novamente.",
      },
      { status: 500 },
    );
  }

  await logAudit({
    action: "connector.removed",
    userId: userContext.user.id,
    workspaceId: account.workspaceId,
    resourceType: "connector_account",
    resourceId: account.id,
    metadata: {
      provider: account.provider,
      accountName: account.accountName,
    },
  });

  return NextResponse.json({ ok: true });
}
