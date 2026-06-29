import { NextResponse, type NextRequest } from "next/server";
import { ConnectorProvider } from "@prisma/client";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import {
  buildShopifyOAuthUrl,
  normalizeShopDomain,
} from "@/lib/connectors/shopify/oauth";
import { SHOPIFY_OAUTH_STATE_COOKIE } from "@/lib/connectors/shopify/state";
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";
import {
  buildShopifyConfigFromProviderConfig,
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
    return redirectToConnectors(request, { provider: "shopify", error: "forbidden" });
  }

  const providerConfig = await getActiveProviderConfig({
    workspaceId: context.currentWorkspace.id,
    provider: ConnectorProvider.SHOPIFY,
  });
  if (!providerConfig) {
    return redirectToConnectors(request, { provider: "shopify", error: "missing-provider-config" });
  }
  const config = await buildShopifyConfigFromProviderConfig(providerConfig);

  const shopParam = request.nextUrl.searchParams.get("shop");
  if (!shopParam) {
    return redirectToConnectors(request, { provider: "shopify", error: "missing-shop" });
  }

  let shop: string;
  try {
    shop = normalizeShopDomain(shopParam);
  } catch {
    return redirectToConnectors(request, { provider: "shopify", error: "invalid-shop" });
  }

  const state = createConnectorOAuthState({
    provider: "SHOPIFY",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    shop,
  });
  const response = NextResponse.redirect(buildShopifyOAuthUrl({ shop, state, config }));

  response.cookies.set(SHOPIFY_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
