import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import {
  ensureDriveFolder,
} from "@/lib/connectors/google-drive/client";
import {
  exchangeGoogleDriveCode,
  getGoogleDriveConfigForRequest,
  GOOGLE_DRIVE_OAUTH_STATE_COOKIE,
  GOOGLE_DRIVE_SCOPE,
} from "@/lib/connectors/google-drive/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import { vaultCredentialFields } from "@/lib/connectors/credentials";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const DRIVE_ROOT_FOLDER_NAME = "W3 Marketplace";

function redirectToConnectors(
  request: NextRequest,
  params: Record<string, string>,
) {
  const url = new URL("/connectors", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_DRIVE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export async function GET(request: NextRequest) {
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[google-drive/callback] failed: ${message}`);
    return redirectToConnectors(request, { provider: "google_drive", error: "oauth-failed" });
  }
}

async function handleCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  if (!state) {
    return redirectToConnectors(request, { provider: "google_drive", error: "invalid-state-no-state-param" });
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    // O usuário negou a tela de consentimento ou o Google devolveu erro.
    const oauthError = request.nextUrl.searchParams.get("error") ?? "missing-code";
    return redirectToConnectors(request, { provider: "google_drive", error: oauthError });
  }

  const context = await getCurrentUserContext();

  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "GOOGLE_DRIVE",
    expectedUserId: context.user.id,
  });

  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "google_drive",
      error: `invalid-state-${verifiedState.reason}`,
    });
  }

  const workspaceId = verifiedState.payload.workspaceId;
  const access = await resolveConnectorWorkspaceAccess({
    userId: context.user.id,
    workspaceId,
  });
  if (!access || !canOperateWorkspaceConnectors(access.user, access.role)) {
    return redirectToConnectors(request, { provider: "google_drive", error: "forbidden" });
  }

  const config = await getGoogleDriveConfigForRequest();
  if (!config) {
    return redirectToConnectors(request, { provider: "google_drive", error: "oauth-providerconfig-missing" });
  }

  try {
    const token = await exchangeGoogleDriveCode({ config, code });

    // Fluxo de workflow de pastas: cria a raiz "W3 Marketplace" no Drive do
    // usuário (idempotente). As imagens ficam organizadas abaixo dela.
    const rootFolder = await ensureDriveFolder({
      accessToken: token.accessToken,
      name: DRIVE_ROOT_FOLDER_NAME,
    });

    // Uma conexão de Drive por workspace — ela é o armazenamento do tenant.
    const externalAccountId = "workspace-drive";
    const accountName = `Google Drive - ${DRIVE_ROOT_FOLDER_NAME}`;

    const credentialFields = await vaultCredentialFields({
      workspaceId,
      provider: ConnectorProvider.GOOGLE_DRIVE,
      externalAccountId,
      credentials: { accessToken: token.accessToken },
      refreshToken: token.refreshToken,
      tokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
    });

    const metadata = {
      scope: token.scope ?? GOOGLE_DRIVE_SCOPE,
      driveRootFolderId: rootFolder.id,
      driveRootFolderName: rootFolder.name,
    };

    const connectorAccount = await prisma.connectorAccount.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: ConnectorProvider.GOOGLE_DRIVE,
          externalAccountId,
        },
      },
      update: {
        accountName,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata,
        lastSyncError: null,
      },
      create: {
        workspaceId,
        provider: ConnectorProvider.GOOGLE_DRIVE,
        externalAccountId,
        accountName,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata,
      },
    });

    await logAudit({
      action: "connector.google_drive.connected",
      userId: context.user.id,
      resourceType: "ConnectorAccount",
      resourceId: connectorAccount.id,
      metadata: { workspaceId, driveRootFolderId: rootFolder.id },
    });

    return redirectToConnectors(request, {
      provider: "google_drive",
      connected: "1",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[google-drive/callback] exchange/bootstrap failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "google_drive",
      error: "bootstrap-failed",
    });
  }
}
