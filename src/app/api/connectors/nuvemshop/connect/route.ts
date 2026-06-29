import { ConnectorProvider } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { resolveAppOrigin } from "@/lib/auth/origin";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { getGlobalNuvemshopConfig } from "@/lib/connectors/nuvemshop/global-config";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildNuvemshopOAuthUrl,
  NUVEMSHOP_OAUTH_STATE_COOKIE,
} from "@/lib/connectors/nuvemshop/oauth";
import {
  buildNuvemshopConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // A transient throw (DB blip, vault miss) must surface as a friendly
  // /connectors?error=… redirect, never a raw HTTP 500 — same contract as the
  // Google connect routes.
  try {
    return await handleConnect(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[nuvemshop/connect] start failed: ${message}`);
    return NextResponse.redirect(
      new URL(
        "/connectors?provider=nuvemshop&error=oauth-failed",
        request.nextUrl.origin,
      ),
    );
  }
}

async function handleConnect(request: NextRequest) {
  const context = await getCurrentUserContext();

  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return NextResponse.redirect(
      new URL(
        "/connectors?provider=nuvemshop&error=forbidden",
        request.nextUrl.origin,
      ),
    );
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId: context.currentWorkspace.id,
    provider: ConnectorProvider.NUVEMSHOP,
  });

  const origin = await resolveAppOrigin();
  const globalConfig = getGlobalNuvemshopConfig(origin);

  const config = providerConfig
    ? await buildNuvemshopConfigFromProviderConfig(providerConfig)
    : globalConfig;

  if (!config) {
    return NextResponse.redirect(
      new URL(
        "/connectors?provider=nuvemshop&error=missing-provider-config",
        request.nextUrl.origin,
      ),
    );
  }

  const state = createConnectorOAuthState({
    provider: ConnectorProvider.NUVEMSHOP,
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
  });
  const response = NextResponse.redirect(
    buildNuvemshopOAuthUrl({ state, config }),
  );
  response.cookies.set(NUVEMSHOP_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
