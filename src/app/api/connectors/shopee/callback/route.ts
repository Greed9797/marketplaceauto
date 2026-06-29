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
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import { ShopeeClient } from "@/lib/connectors/shopee/client";
import { SHOPEE_OAUTH_STATE_COOKIE } from "@/lib/connectors/shopee/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildShopeeConfigFromProviderConfig,
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
  response.cookies.set(SHOPEE_OAUTH_STATE_COOKIE, "", {
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
  // 500 — same contract as the Mercado Livre/Shopify callbacks.
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[shopee/callback] failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "shopee",
      error: "oauth-failed",
    });
  }
}

async function handleCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  if (!state) {
    return redirectToConnectors(request, {
      provider: "shopee",
      error: "invalid-state-no-state-param",
    });
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToConnectors(request, {
      provider: "shopee",
      error: "missing-code",
    });
  }

  const shopIdParam = request.nextUrl.searchParams.get("shop_id");
  const shopId = Number(shopIdParam);
  if (!shopIdParam || !Number.isFinite(shopId) || shopId <= 0) {
    return redirectToConnectors(request, {
      provider: "shopee",
      error: "missing-shop-id",
    });
  }

  const context = await getCurrentUserContext();

  // Verify the signed state FIRST — it is self-contained (HMAC over its own
  // payload) and tells us the authoritative workspace, independent of the
  // request cookie (dropped on the cross-site OAuth return).
  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "SHOPEE",
    expectedUserId: context.user.id,
  });

  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "shopee",
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
      provider: "shopee",
      error: "forbidden",
    });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.SHOPEE,
  });
  const origin = await resolveAppOrigin();
  const config = providerConfig
    ? await buildShopeeConfigFromProviderConfig(providerConfig)
    : getGlobalShopeeConfig(origin);

  if (!config) {
    return redirectToConnectors(request, {
      provider: "shopee",
      error: "oauth-providerconfig-missing",
    });
  }

  try {
    const client = new ShopeeClient({ config });
    const token = await client.exchangeCodeForAccessToken({ code, shopId });
    const externalAccountId = String(token.shopId);
    const accountName = `Shopee ${externalAccountId}`;

    const credentialFields = await vaultCredentialFields({
      workspaceId,
      provider: ConnectorProvider.SHOPEE,
      externalAccountId,
      credentials: { accessToken: token.accessToken },
      refreshToken: token.refreshToken,
      tokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
    });

    const connectorAccount = await prisma.connectorAccount.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: ConnectorProvider.SHOPEE,
          externalAccountId,
        },
      },
      update: {
        accountName,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata: {
          shopId: token.shopId,
        },
        lastSyncError: null,
      },
      create: {
        workspaceId,
        provider: ConnectorProvider.SHOPEE,
        externalAccountId,
        accountName,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata: {
          shopId: token.shopId,
        },
      },
    });

    if (process.env.INNGEST_EVENT_KEY) {
      await inngest.send(
        buildConnectorBackfillEvent({
          provider: ConnectorProvider.SHOPEE,
          connectorAccountId: connectorAccount.id,
        }),
      );
    }

    await logAudit({
      action: "connector.shopee.connect",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_account",
      resourceId: externalAccountId,
      metadata: {
        provider: "SHOPEE",
        backfillQueued: Boolean(process.env.INNGEST_EVENT_KEY),
      },
    });

    return redirectToConnectors(request, {
      provider: "shopee",
      connected: "shopee",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown";
    const isVaultMissing =
      message.includes("Secret not found") ||
      message.includes("Vault credential unavailable") ||
      message.includes("Credentials missing");
    const errorCode = isVaultMissing ? "oauth-vault-missing" : "oauth-failed";

    return redirectToConnectors(request, {
      provider: "shopee",
      error: errorCode,
    });
  }
}
