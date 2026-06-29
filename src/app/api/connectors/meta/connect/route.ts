import { NextResponse, type NextRequest } from "next/server";
import { ConnectorProvider } from "@prisma/client";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";
import { buildMetaOAuthUrl } from "@/lib/connectors/meta/oauth";
import { META_OAUTH_STATE_COOKIE } from "@/lib/connectors/meta/state";
import {
  buildMetaConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";

export const runtime = "nodejs";

function redirectToConnectors(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/connectors", request.nextUrl.origin);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const context = await getCurrentUserContext();
  if (!canOperateWorkspaceConnectors(context.user, context.currentMembership.role)) {
    return redirectToConnectors(request, { provider: "meta", error: "forbidden" });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId: context.currentWorkspace.id,
    provider: ConnectorProvider.META_ADS,
  });
  if (!providerConfig) {
    return redirectToConnectors(request, { provider: "meta", error: "missing-provider-config" });
  }
  const config = await buildMetaConfigFromProviderConfig(providerConfig);

  const state = createConnectorOAuthState({
    provider: "META_ADS",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
  });
  const response = NextResponse.redirect(buildMetaOAuthUrl({ state, config }));

  response.cookies.set(META_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
