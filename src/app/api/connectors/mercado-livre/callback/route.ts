import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { resolveAppOrigin } from "@/lib/auth/origin";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildConnectorBackfillEvent } from "@/lib/connectors/backfill";
import { vaultCredentialFields } from "@/lib/connectors/credentials";
import { getGlobalMercadoLivreConfig } from "@/lib/connectors/mercado-livre/global-config";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { MERCADO_LIVRE_OAUTH_STATE_COOKIE } from "@/lib/connectors/mercado-livre/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildMercadoLivreConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
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

  const response = NextResponse.redirect(url);
  response.cookies.set(MERCADO_LIVRE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export async function GET(request: NextRequest) {
  // The pre-exchange section (context, state, access, provider config) can throw
  // on transient failures; that must become a friendly redirect, never an HTTP
  // 500 — same contract as the Shopify/Nuvemshop callbacks.
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[mercado-livre/callback] failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: "oauth-failed",
    });
  }
}

async function handleCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  if (!state) {
    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: "invalid-state-no-state-param",
    });
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: "missing-code",
    });
  }

  const context = await getCurrentUserContext();

  // Verify the signed state FIRST — it is self-contained (HMAC over its own
  // payload) and tells us the authoritative workspace, independent of the
  // request cookie (dropped on the cross-site OAuth return).
  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "MERCADO_LIVRE",
    expectedUserId: context.user.id,
  });

  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: `invalid-state-${verifiedState.reason}`,
    });
  }

  const workspaceId = verifiedState.payload.workspaceId;
  const access = await resolveConnectorWorkspaceAccess({
    userId: context.user.id,
    workspaceId,
  });
  if (!access || !canOperateWorkspaceConnectors(access.user, access.role)) {
    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: "forbidden",
    });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.MERCADO_LIVRE,
  });
  const origin = await resolveAppOrigin();
  const config = providerConfig
    ? await buildMercadoLivreConfigFromProviderConfig(providerConfig)
    : getGlobalMercadoLivreConfig(origin);

  if (!config) {
    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: "oauth-providerconfig-missing",
    });
  }

  try {
    const client = new MercadoLivreClient({ config });
    const token = await client.exchangeCodeForAccessToken(code);
    const sellerId = token.userId;
    if (!sellerId) {
      return redirectToConnectors(request, {
        provider: "mercado_livre",
        error: "oauth-failed",
      });
    }

    const profile = await client.fetchSellerProfile({
      sellerId,
      accessToken: token.accessToken,
    });
    const accountName = profile.nickname
      ? `Mercado Livre - ${profile.nickname}`
      : `Mercado Livre ${sellerId}`;

    const credentialFields = await vaultCredentialFields({
      workspaceId,
      provider: ConnectorProvider.MERCADO_LIVRE,
      externalAccountId: sellerId,
      credentials: { accessToken: token.accessToken },
      refreshToken: token.refreshToken,
      tokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
    });

    const connectorAccount = await prisma.connectorAccount.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: ConnectorProvider.MERCADO_LIVRE,
          externalAccountId: sellerId,
        },
      },
      update: {
        accountName,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata: {
          scope: token.scope,
          sellerNickname: profile.nickname,
        },
        lastSyncError: null,
      },
      create: {
        workspaceId,
        provider: ConnectorProvider.MERCADO_LIVRE,
        externalAccountId: sellerId,
        accountName,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata: {
          scope: token.scope,
          sellerNickname: profile.nickname,
        },
      },
    });

    if (process.env.INNGEST_EVENT_KEY) {
      await inngest.send(
        buildConnectorBackfillEvent({
          provider: ConnectorProvider.MERCADO_LIVRE,
          connectorAccountId: connectorAccount.id,
          scopes: token.scope,
        }),
      );
    }

    await logAudit({
      action: "connector.mercado_livre.connect",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_account",
      resourceId: sellerId,
      metadata: {
        provider: "MERCADO_LIVRE",
        backfillQueued: Boolean(process.env.INNGEST_EVENT_KEY),
      },
    });

    return redirectToConnectors(request, {
      provider: "mercado_livre",
      connected: "mercado_livre",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown";
    const isVaultMissing =
      message.includes("Secret not found") ||
      message.includes("Vault credential unavailable") ||
      message.includes("Credentials missing");
    const errorCode = isVaultMissing ? "oauth-vault-missing" : "oauth-failed";

    return redirectToConnectors(request, {
      provider: "mercado_livre",
      error: errorCode,
    });
  }
}
