import { ConnectorProvider } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { resolveAppOrigin } from "@/lib/auth/origin";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { NuvemshopClient } from "@/lib/connectors/nuvemshop/client";
import { getGlobalNuvemshopConfig } from "@/lib/connectors/nuvemshop/global-config";
import { NUVEMSHOP_OAUTH_STATE_COOKIE } from "@/lib/connectors/nuvemshop/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildNuvemshopConfigFromProviderConfig,
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
  response.cookies.set(NUVEMSHOP_OAUTH_STATE_COOKIE, "", {
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
    console.error(`[nuvemshop/callback] failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: "oauth-failed",
    });
  }
}

async function handleCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const context = await getCurrentUserContext();

  if (!state) {
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: "invalid-state",
      debug: "no-state-param",
    });
  }

  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "NUVEMSHOP",
    expectedUserId: context.user.id,
    // workspaceId read from signed payload below — cookie unreliable on return.
  });
  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: "invalid-state",
      debug: `hmac-${verifiedState.reason}`,
    });
  }

  const workspaceId = verifiedState.payload.workspaceId;
  const access = await resolveConnectorWorkspaceAccess({
    userId: context.user.id,
    workspaceId,
  });
  if (!access) {
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: "forbidden",
    });
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: "missing-code",
    });
  }
  if (!canOperateWorkspaceConnectors(access.user, access.role)) {
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: "forbidden",
    });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.NUVEMSHOP,
  });

  const origin = await resolveAppOrigin();
  const globalConfig = getGlobalNuvemshopConfig(origin);

  try {
    const config = providerConfig
      ? await buildNuvemshopConfigFromProviderConfig(providerConfig)
      : globalConfig;

    if (!config) {
      return redirectToConnectors(request, {
        provider: "nuvemshop",
        error: "oauth-providerconfig-missing",
      });
    }
    const token = await new NuvemshopClient({
      config,
    }).exchangeCodeForAccessToken(code);
    const selection = await createConnectorSelectionSession({
      workspaceId,
      userId: context.user.id,
      provider: ConnectorProvider.NUVEMSHOP,
      accounts: [
        {
          externalAccountId: token.storeId,
          accountName: `Nuvemshop ${token.storeId}`,
          metadata: {
            scope: token.scope,
            tokenType: token.tokenType,
            apiBaseUrl: config.apiBaseUrl,
          },
        },
      ],
      credentials: {
        accessToken: token.accessToken,
        storeId: token.storeId,
        apiBaseUrl: config.apiBaseUrl,
      },
    });

    await logAudit({
      action: "connector.nuvemshop.selection_created",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_selection_session",
      resourceId: selection.id,
      metadata: { provider: "NUVEMSHOP", accounts: 1 },
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

    console.error(`[nuvemshop/callback] ${errorCode}: ${message}`);

    // Do not echo raw error text into the redirect URL — it can leak token
    // exchange details and enable fingerprinting. Keep raw text in server
    // logs only; expose only the stable error code to the browser.
    return redirectToConnectors(request, {
      provider: "nuvemshop",
      error: errorCode,
    });
  }
}
