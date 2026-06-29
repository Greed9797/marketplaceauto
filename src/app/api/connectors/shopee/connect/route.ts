import { ConnectorProvider } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { resolveAppOrigin } from "@/lib/auth/origin";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import {
  buildShopeeOAuthUrl,
  SHOPEE_OAUTH_STATE_COOKIE,
} from "@/lib/connectors/shopee/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildShopeeConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // A transient throw (DB blip, vault miss) must surface as a friendly
  // /connectors?error=… redirect, never a raw HTTP 500.
  try {
    return await handleConnect(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[shopee/connect] start failed: ${message}`);
    return NextResponse.redirect(
      new URL(
        "/connectors?provider=shopee&error=oauth-failed",
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
        "/connectors?provider=shopee&error=forbidden",
        request.nextUrl.origin,
      ),
    );
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId: context.currentWorkspace.id,
    provider: ConnectorProvider.SHOPEE,
  });

  const origin = await resolveAppOrigin();
  const globalConfig = getGlobalShopeeConfig(origin);

  const config = providerConfig
    ? await buildShopeeConfigFromProviderConfig(providerConfig)
    : globalConfig;

  if (!config) {
    return NextResponse.redirect(
      new URL(
        "/connectors?provider=shopee&error=missing-provider-config",
        request.nextUrl.origin,
      ),
    );
  }

  const state = createConnectorOAuthState({
    provider: "SHOPEE",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
  });
  const response = NextResponse.redirect(
    buildShopeeOAuthUrl({ state, config }),
  );
  response.cookies.set(SHOPEE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
