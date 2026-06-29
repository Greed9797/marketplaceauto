import { NextResponse, type NextRequest } from "next/server";
import { ConnectorProvider } from "@prisma/client";

import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildGoogleAnalyticsOAuthUrl } from "@/lib/connectors/google-analytics/oauth";
import { GOOGLE_ANALYTICS_OAUTH_STATE_COOKIE } from "@/lib/connectors/google-analytics/state";
import { syntheticProviderConfigFromDefaults } from "@/lib/connectors/global-defaults";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildGoogleAnalyticsConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";

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

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentUserContext();

    // The target workspace is carried EXPLICITLY in the `ws` query param (set by
    // the connectors page from the workspace shown in the "Conectando para…"
    // banner). This removes any dependency on the request cookie, which can
    // drift/drop and otherwise fall back to the oldest workspace (W3 Dev). The
    // requested workspace is always re-validated against the user's access.
    const requestedWorkspaceId = request.nextUrl.searchParams.get("ws");
    let targetWorkspaceId = context.currentWorkspace.id;
    let targetRole = context.currentMembership.role;
    if (requestedWorkspaceId && requestedWorkspaceId !== targetWorkspaceId) {
      const access = await resolveConnectorWorkspaceAccess({
        userId: context.user.id,
        workspaceId: requestedWorkspaceId,
      });
      if (!access) {
        return redirectToConnectors(request, {
          provider: "google-analytics",
          error: "forbidden",
        });
      }
      targetWorkspaceId = requestedWorkspaceId;
      targetRole = access.role;
    }

    if (!canOperateWorkspaceConnectors(context.user, targetRole)) {
      return redirectToConnectors(request, {
        provider: "google-analytics",
        error: "forbidden",
      });
    }

    const providerConfig =
      (await getActiveProviderConfig({
        workspaceId: targetWorkspaceId,
        provider: ConnectorProvider.GA4,
      })) ??
      syntheticProviderConfigFromDefaults(
        targetWorkspaceId,
        ConnectorProvider.GA4,
      );
    if (!providerConfig) {
      return redirectToConnectors(request, {
        provider: "google-analytics",
        error: "missing-provider-config",
      });
    }
    const config =
      await buildGoogleAnalyticsConfigFromProviderConfig(providerConfig);

    // Derive redirect_uri from the host the user is actually on instead of the
    // GOOGLE_ANALYTICS_REDIRECT_URI env, which had drifted to a stale host
    // (w3ads vs w3-ads) and sent Google's return trip to a 404. Connect and
    // callback derive it identically so the token exchange always matches. The
    // resulting URI must be registered in the Google OAuth client.
    const redirectUri = new URL(
      "/api/connectors/google-analytics/callback",
      request.nextUrl.origin,
    ).toString();

    const state = createConnectorOAuthState({
      provider: "GA4",
      userId: context.user.id,
      workspaceId: targetWorkspaceId,
    });
    const response = NextResponse.redirect(
      buildGoogleAnalyticsOAuthUrl({
        state,
        config: { ...config, redirectUri },
      }),
    );

    response.cookies.set(GOOGLE_ANALYTICS_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });

    return response;
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[google-analytics/connect] start failed: ${message}`);
    return redirectToConnectors(request, {
      provider: "google-analytics",
      error: "oauth-failed",
    });
  }
}
