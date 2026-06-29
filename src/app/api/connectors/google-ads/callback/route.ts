import { ConnectorProvider } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import { getLaxCookieOptions } from "@/lib/auth/cookies";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { GoogleAdsClient } from "@/lib/connectors/google-ads/client";
import { GOOGLE_ADS_OAUTH_STATE_COOKIE } from "@/lib/connectors/google-ads/state";
import { verifyConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildGoogleAdsConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { createConnectorSelectionSession } from "@/lib/connectors/selection";

export const runtime = "nodejs";

function redirectToConnectors(
  request: NextRequest,
  params: Record<string, string>,
  // When the signed state has already been verified, pass its workspaceId so
  // the active workspace is re-asserted even on error — otherwise the dropped
  // OAuth cookie reverts the user to the agency's most-connected workspace.
  workspaceId?: string,
) {
  const url = new URL("/connectors", request.nextUrl.origin);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_ADS_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  if (workspaceId) {
    response.cookies.set(
      "adstart_workspace_id",
      workspaceId,
      getLaxCookieOptions({ maxAge: 60 * 60 * 24 * 180 }),
    );
  }

  return response;
}

function tokenExpiresAt(expiresInSeconds: number | undefined) {
  return expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000)
    : null;
}

export async function GET(request: NextRequest) {
  try {
    return await runGoogleAdsCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[google-ads/callback] unexpected failure: ${message}`);
    return redirectToConnectors(request, {
      provider: "google-ads",
      error: "oauth-failed",
    });
  }
}

async function runGoogleAdsCallback(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const context = await getCurrentUserContext();

  if (!state) {
    return redirectToConnectors(request, {
      provider: "google-ads",
      error: "invalid-state",
      debug: "no-state-param",
    });
  }

  const verifiedState = verifyConnectorOAuthState(state, {
    expectedProvider: "GOOGLE_ADS",
    expectedUserId: context.user.id,
    // workspaceId intentionally NOT compared against the cookie — it is read
    // from the signed payload below (cookie is unreliable on OAuth return).
  });

  if (!verifiedState.valid) {
    return redirectToConnectors(request, {
      provider: "google-ads",
      error: "invalid-state",
      debug: `hmac-${verifiedState.reason}`,
    });
  }

  // Authoritative workspace = the one signed into the state at init time.
  const workspaceId = verifiedState.payload.workspaceId;
  const access = await resolveConnectorWorkspaceAccess({
    userId: context.user.id,
    workspaceId,
  });
  if (!access) {
    return redirectToConnectors(
      request,
      { provider: "google-ads", error: "forbidden" },
      workspaceId,
    );
  }

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return redirectToConnectors(
      request,
      { provider: "google-ads", error: "provider-denied" },
      workspaceId,
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToConnectors(
      request,
      { provider: "google-ads", error: "missing-code" },
      workspaceId,
    );
  }
  if (!canOperateWorkspaceConnectors(access.user, access.role)) {
    return redirectToConnectors(
      request,
      { provider: "google-ads", error: "forbidden" },
      workspaceId,
    );
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId,
    provider: ConnectorProvider.GOOGLE_ADS,
  });
  if (!providerConfig) {
    return redirectToConnectors(
      request,
      { provider: "google-ads", error: "oauth-providerconfig-missing" },
      workspaceId,
    );
  }

  try {
    const client = new GoogleAdsClient({
      config: {
        ...(await buildGoogleAdsConfigFromProviderConfig(providerConfig)),
        // Must match the redirect_uri sent at connect time (also derived from
        // the request origin), or Google rejects the token exchange.
        redirectUri: new URL(
          "/api/connectors/google-ads/callback",
          request.nextUrl.origin,
        ).toString(),
      },
    });
    const token = await client.exchangeCodeForTokens(code);
    const customers = await client.listSelectableCustomers(token.access_token);
    const expiresAt = tokenExpiresAt(token.expires_in);
    const selection = await createConnectorSelectionSession({
      workspaceId,
      userId: context.user.id,
      provider: ConnectorProvider.GOOGLE_ADS,
      accounts: customers.map((customer) => ({
        externalAccountId: customer.id,
        accountName: customer.name,
        metadata: {
          resourceName: customer.resourceName,
          currencyCode: customer.currencyCode,
          timeZone: customer.timeZone,
          loginCustomerId: customer.loginCustomerId,
          rootCustomerId: customer.rootCustomerId,
        },
      })),
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: expiresAt?.toISOString(),
      },
    });

    await logAudit({
      action: "connector.google_ads.selection_created",
      userId: context.user.id,
      workspaceId,
      resourceType: "connector_selection_session",
      resourceId: selection.id,
      metadata: {
        provider: "GOOGLE_ADS",
        accounts: customers.length,
      },
    });

    const url = new URL("/connectors/select", request.nextUrl.origin);
    url.searchParams.set("session", selection.id);

    const redirectResponse = NextResponse.redirect(url);
    // Re-assert the workspace from the signed OAuth state. The selection cookie
    // is commonly dropped on the cross-site OAuth return, which would otherwise
    // leave the sidebar/context on the agency's default workspace (the one with
    // the most connectors) instead of the client this connection targets.
    redirectResponse.cookies.set(
      "adstart_workspace_id",
      workspaceId,
      getLaxCookieOptions({ maxAge: 60 * 60 * 24 * 180 }),
    );

    return redirectResponse;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown";
    const isVaultMissing =
      message.includes("Secret not found") ||
      message.includes("Vault credential unavailable") ||
      message.includes("Credentials missing");
    const errorCode = isVaultMissing ? "oauth-vault-missing" : "oauth-failed";

    console.error(`[google-ads/callback] ${errorCode}: ${message}`);

    return redirectToConnectors(
      request,
      {
        provider: "google-ads",
        error: errorCode,
        // Don't leak internal/upstream error text into the browser URL,
        // history or referrer in production — it's already logged above.
        ...(process.env.NODE_ENV === "production"
          ? {}
          : { debug: message.slice(0, 200) }),
      },
      workspaceId,
    );
  }
}
