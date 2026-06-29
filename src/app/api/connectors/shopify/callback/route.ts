import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildConnectorBackfillEvent } from "@/lib/connectors/backfill";
import { vaultCredentialFields } from "@/lib/connectors/credentials";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildShopifyConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { ShopifyClient } from "@/lib/connectors/shopify/client";
import {
  normalizeShopDomain,
  verifyShopifyQueryHmac,
} from "@/lib/connectors/shopify/oauth";
import { SHOPIFY_OAUTH_STATE_COOKIE } from "@/lib/connectors/shopify/state";
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
  response.cookies.set(SHOPIFY_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export async function GET(request: NextRequest) {
  // The pre-exchange section (context, state, access, provider config, HMAC)
  // can throw on transient failures; that must become a friendly redirect,
  // never a raw HTTP 500 — same contract as the Google callbacks.
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[shopify/callback] failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "shopify",
      error: "oauth-failed",
    });
  }
}

async function handleCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const debugKeys = Array.from(request.nextUrl.searchParams.keys())
    .filter((key) => !["code", "state", "hmac"].includes(key))
    .concat(state ? ["state-present"] : ["state-missing"])
    .join(",");

  if (!state) {
    return redirectToConnectors(request, {
      provider: "shopify",
      error: "invalid-state-no-state-param",
      debug: debugKeys,
    });
  }

  const code = request.nextUrl.searchParams.get("code");
  const shopParam = request.nextUrl.searchParams.get("shop");

  if (!code || !shopParam) {
    return redirectToConnectors(request, {
      provider: "shopify",
      error: "missing-code",
    });
  }

  const shop = normalizeShopDomain(shopParam);
  const context = await getCurrentUserContext();

  // Verify the signed state FIRST — it is self-contained (HMAC over its own
  // payload) and tells us the authoritative workspace, independent of the
  // request cookie (dropped on the cross-site OAuth return).
  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "SHOPIFY",
    expectedUserId: context.user.id,
    expectedShop: shop,
    // workspaceId read from signed payload below.
  });

  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "shopify",
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
      provider: "shopify",
      error: "forbidden",
    });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.SHOPIFY,
  });
  if (!providerConfig) {
    return redirectToConnectors(request, {
      provider: "shopify",
      error: "oauth-providerconfig-missing",
    });
  }

  const config = await buildShopifyConfigFromProviderConfig(providerConfig);
  if (!verifyShopifyQueryHmac(request.nextUrl.searchParams, config.apiSecret)) {
    return redirectToConnectors(request, {
      provider: "shopify",
      error: "invalid-hmac",
    });
  }

  try {
    const client = new ShopifyClient({ config });
    const token = await client.exchangeCodeForAccessToken({ shop, code });
    const credentialFields = await vaultCredentialFields({
      workspaceId,
      provider: ConnectorProvider.SHOPIFY,
      externalAccountId: shop,
      credentials: { accessToken: token.access_token },
    });

    const connectorAccount = await prisma.connectorAccount.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: ConnectorProvider.SHOPIFY,
          externalAccountId: shop,
        },
      },
      update: {
        accountName: shop,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata: {
          scope: token.scope,
          apiVersion: config.apiVersion,
        },
        lastSyncError: null,
      },
      create: {
        workspaceId,
        provider: ConnectorProvider.SHOPIFY,
        externalAccountId: shop,
        accountName: shop,
        status: ConnectorStatus.ACTIVE,
        ...credentialFields,
        metadata: {
          scope: token.scope,
          apiVersion: config.apiVersion,
        },
      },
    });

    await client.ensureWebhookSubscriptions({
      shop,
      accessToken: token.access_token,
    });

    if (process.env.INNGEST_EVENT_KEY) {
      await inngest.send(
        buildConnectorBackfillEvent({
          provider: ConnectorProvider.SHOPIFY,
          connectorAccountId: connectorAccount.id,
          scopes: token.scope ?? config.scopes,
        }),
      );
    }

    await logAudit({
      action: "connector.shopify.connect",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_account",
      resourceId: shop,
      metadata: {
        provider: "SHOPIFY",
        backfillQueued: Boolean(process.env.INNGEST_EVENT_KEY),
      },
    });

    return redirectToConnectors(request, {
      provider: "shopify",
      connected: "shopify",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown";
    const isVaultMissing =
      message.includes("Secret not found") ||
      message.includes("Vault credential unavailable") ||
      message.includes("Credentials missing");
    const errorCode = isVaultMissing ? "oauth-vault-missing" : "oauth-failed";

    return redirectToConnectors(request, {
      provider: "shopify",
      error: errorCode,
    });
  }
}
