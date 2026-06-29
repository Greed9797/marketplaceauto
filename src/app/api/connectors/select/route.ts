import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import { getLaxCookieOptions } from "@/lib/auth/cookies";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildConnectorBackfillEvent } from "@/lib/connectors/backfill";
import { isInngestConfigured } from "@/lib/connectors/inngest-config";
import {
  loadSelectionCredentials,
  parseSelectableAccounts,
  vaultSelectedAccountCredentials,
} from "@/lib/connectors/selection";
import { prisma } from "@/lib/db/prisma";
import { inngest } from "@/lib/jobs/inngest-client";

export const runtime = "nodejs";

function redirectToConnectors(
  request: NextRequest,
  params: Record<string, string>,
) {
  const url = new URL("/connectors", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  const context = await getCurrentUserContext();
  const formData = await request.formData();
  const sessionId = String(formData.get("sessionId") ?? "");
  const selectedExternalAccountIds = formData
    .getAll("externalAccountId")
    .map((value) => String(value))
    .filter(Boolean);

  if (!sessionId || selectedExternalAccountIds.length === 0) {
    return redirectToConnectors(request, { error: "missing-selection" });
  }

  // The selection row is the source of truth for the target workspace (set by
  // the OAuth callback from the signed state). Do NOT scope by the request
  // cookie — it is dropped on the cross-site OAuth return and would point at
  // the wrong (first) workspace.
  const selection = await prisma.connectorSelectionSession.findFirst({
    where: {
      id: sessionId,
      userId: context.user.id,
      status: "PENDING",
    },
  });

  if (!selection || selection.expiresAt.getTime() < Date.now()) {
    return redirectToConnectors(request, { error: "selection-expired" });
  }

  const access = await resolveConnectorWorkspaceAccess({
    userId: context.user.id,
    workspaceId: selection.workspaceId,
  });
  if (!access || !canOperateWorkspaceConnectors(access.user, access.role)) {
    return redirectToConnectors(request, { error: "forbidden" });
  }
  const workspaceId = selection.workspaceId;

  try {
    const credentials = await loadSelectionCredentials(selection);
    const accounts = parseSelectableAccounts(selection.accounts);
    const accountsById = new Map(
      accounts.map((account) => [account.externalAccountId, account]),
    );
    const selected = selectedExternalAccountIds.map((id) => {
      const account = accountsById.get(id);
      if (!account) {
        throw new Error("Selected connector account was not found");
      }

      return account;
    });
    // Vault calls hit the global Prisma pool via $queryRaw; running them
    // inside a $transaction holds the tx connection open while we wait on
    // network I/O, which on a small serverless pool either starves the
    // tx-start window (maxWait) or trips the 5s tx timeout. Pre-compute
    // everything Vault-related first, then the tx is just sequential
    // Postgres writes.
    const credentialFieldsByAccount = await Promise.all(
      selected.map((account) =>
        vaultSelectedAccountCredentials({
          workspaceId,
          provider: selection.provider,
          externalAccountId: account.externalAccountId,
          credentials,
        }),
      ),
    );

    const connectorAccountIds = await prisma.$transaction(
      async (tx) => {
        const ids: string[] = [];

        for (let i = 0; i < selected.length; i++) {
          const account = selected[i];
          const credentialFields = credentialFieldsByAccount[i];
          const connectorAccount = await tx.connectorAccount.upsert({
            where: {
              workspaceId_provider_externalAccountId: {
                workspaceId,
                provider: selection.provider,
                externalAccountId: account.externalAccountId,
              },
            },
            update: {
              accountName: account.accountName,
              status: "ACTIVE",
              ...credentialFields,
              metadata: account.metadata ?? undefined,
              lastSyncError: null,
            },
            create: {
              workspaceId,
              provider: selection.provider,
              externalAccountId: account.externalAccountId,
              accountName: account.accountName,
              status: "ACTIVE",
              ...credentialFields,
              metadata: account.metadata ?? undefined,
            },
          });
          ids.push(connectorAccount.id);
        }

        await tx.connectorSelectionSession.update({
          where: { id: selection.id },
          data: {
            status: "CONSUMED",
            consumedAt: new Date(),
          },
        });

        return ids;
      },
      { timeout: 15000, maxWait: 5000 },
    );

    const inngestConfigured = isInngestConfigured();
    let backfillQueued = false;
    let inngestSendError: string | null = null;
    let syncMode: "inngest" | "deferred" = "deferred";

    if (inngestConfigured) {
      try {
        await Promise.all(
          connectorAccountIds.map((connectorAccountId) =>
            inngest.send(
              buildConnectorBackfillEvent({
                provider: selection.provider,
                connectorAccountId,
              }),
            ),
          ),
        );
        backfillQueued = true;
        syncMode = "inngest";
      } catch (sendError: unknown) {
        inngestSendError =
          sendError instanceof Error
            ? sendError.message
            : "inngest send failed";

        // ConnectorStatus has no PENDING_SYNC; keep ACTIVE but stamp metadata so
        // ops/admins can surface the failure and trigger a manual /sync.
        for (const connectorAccountId of connectorAccountIds) {
          try {
            const existing = await prisma.connectorAccount.findUnique({
              where: { id: connectorAccountId },
              select: { metadata: true },
            });
            const baseMetadata: Record<string, unknown> =
              existing?.metadata &&
              typeof existing.metadata === "object" &&
              !Array.isArray(existing.metadata)
                ? (existing.metadata as Record<string, unknown>)
                : {};

            await prisma.connectorAccount.update({
              where: { id: connectorAccountId },
              data: {
                metadata: {
                  ...baseMetadata,
                  inngestSendError,
                },
              },
            });
          } catch {
            // Non-fatal: metadata stamping failure shouldn't fail OAuth completion.
          }
        }
      }
    }

    await logAudit({
      action: "connector.selection.connect",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_selection_session",
      resourceId: selection.id,
      metadata: {
        provider: selection.provider,
        accounts: selected.length,
        backfillQueued,
        syncMode,
        ...(inngestSendError ? { inngestSendError } : {}),
      },
    });

    const response = redirectToConnectors(request, {
      provider: selection.provider.toLowerCase(),
      connected: selection.provider.toLowerCase(),
    });
    // Keep the active workspace on the one we just linked the connector to, so
    // the dashboard the user lands on matches the client they connected (the
    // OAuth cookie was likely dropped on the cross-site return).
    response.cookies.set(
      "adstart_workspace_id",
      workspaceId,
      getLaxCookieOptions({ maxAge: 60 * 60 * 24 * 180 }),
    );

    return response;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown";
    const error = message.includes("Secret not found")
      ? "selection-expired"
      : "selection-failed";

    console.error(`[connectors/select] ${error}: ${message}`);

    return redirectToConnectors(request, {
      error,
      debug: message.slice(0, 200),
    });
  }
}
