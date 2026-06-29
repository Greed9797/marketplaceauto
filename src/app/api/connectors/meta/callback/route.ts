import { ConnectorProvider } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import {
  MetaMarketingClient,
  tokenExpiresAt,
} from "@/lib/connectors/meta/client";
import { META_OAUTH_STATE_COOKIE } from "@/lib/connectors/meta/state";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildMetaConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { createConnectorSelectionSession } from "@/lib/connectors/selection";

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
  response.cookies.set(META_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export async function GET(request: NextRequest) {
  // The pre-exchange section (context, state, access, provider config) can
  // throw on transient failures; that must become a friendly redirect, never
  // a raw HTTP 500 — same contract as the Google callbacks.
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[meta/callback] failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "meta",
      error: "oauth-failed",
    });
  }
}

async function handleCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(META_OAUTH_STATE_COOKIE)?.value;
  const context = await getCurrentUserContext();

  if (!state || !storedState || state !== storedState) {
    return redirectToConnectors(request, {
      provider: "meta",
      error: "invalid-state",
    });
  }

  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "META_ADS",
    expectedUserId: context.user.id,
    // workspaceId read from signed payload below — cookie unreliable on return.
  });

  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "meta",
      error: "invalid-state",
    });
  }

  const workspaceId = verifiedState.payload.workspaceId;
  const access = await resolveConnectorWorkspaceAccess({
    userId: context.user.id,
    workspaceId,
  });
  // Authorization gate runs before token exchange — a user who lost the
  // connector-operate permission mid-flow must not hit Meta with the workspace's
  // App Secret. Saves an API call and avoids confusing partial-state.
  if (!access || !canOperateWorkspaceConnectors(access.user, access.role)) {
    return redirectToConnectors(request, {
      provider: "meta",
      error: "forbidden",
    });
  }

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return redirectToConnectors(request, {
      provider: "meta",
      error: "provider-denied",
    });
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToConnectors(request, {
      provider: "meta",
      error: "missing-code",
    });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.META_ADS,
  });
  if (!providerConfig) {
    return redirectToConnectors(request, {
      provider: "meta",
      error: "oauth-providerconfig-missing",
    });
  }

  try {
    const client = new MetaMarketingClient({
      config: await buildMetaConfigFromProviderConfig(providerConfig),
    });
    const shortLivedToken = await client.exchangeCodeForShortLivedToken(code);
    const longLivedToken = await client.exchangeForLongLivedToken(
      shortLivedToken.access_token,
    );
    const accounts = await client.listAdAccounts(longLivedToken.access_token);
    const expiresAt = tokenExpiresAt(longLivedToken.expires_in);
    const selection = await createConnectorSelectionSession({
      workspaceId,
      userId: context.user.id,
      provider: ConnectorProvider.META_ADS,
      accounts: accounts.map((account) => ({
        externalAccountId: account.id,
        accountName: account.name,
        metadata: {
          accountId: account.accountId,
          currency: account.currency,
          timezone: account.timezoneName,
        },
      })),
      credentials: {
        accessToken: longLivedToken.access_token,
        tokenExpiresAt: expiresAt?.toISOString(),
      },
    });

    await logAudit({
      action: "connector.meta.selection_created",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_selection_session",
      resourceId: selection.id,
      metadata: {
        provider: "META_ADS",
        accounts: accounts.length,
      },
    });

    const url = new URL("/connectors/select", request.nextUrl.origin);
    url.searchParams.set("session", selection.id);

    return NextResponse.redirect(url);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown";
    const isVaultMissing =
      message.includes("Secret not found") ||
      message.includes("Vault credential unavailable") ||
      message.includes("Credentials missing");
    const errorCode = isVaultMissing ? "oauth-vault-missing" : "oauth-failed";

    return redirectToConnectors(request, {
      provider: "meta",
      error: errorCode,
    });
  }
}
