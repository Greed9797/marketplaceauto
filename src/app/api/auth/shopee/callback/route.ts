import { PublisherPlatform } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { ShopeeClient } from "@/lib/connectors/shopee/client";
import { prisma } from "@/lib/db/prisma";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import { encryptClienteTokens } from "@/lib/publisher/cliente-tokens";
import {
  clearOAuthCookie,
  SHOPEE_CLIENTE_COOKIE,
  SHOPEE_STATE_COOKIE,
} from "@/lib/publisher/oauth-cookies";
import { getShopeeEnvConfig } from "@/lib/publisher/shopee-env-config";

export const runtime = "nodejs";

function redirectClientes(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/clientes", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  clearOAuthCookie(response, SHOPEE_CLIENTE_COOKIE);
  clearOAuthCookie(response, SHOPEE_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[auth/shopee/callback] failed: ${message}`);
    return redirectClientes(request, { error: "oauth-failed" });
  }
}

async function handleCallback(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const shopIdParam = request.nextUrl.searchParams.get("shop_id");
  const state = request.nextUrl.searchParams.get("state");
  const clienteId = request.cookies.get(SHOPEE_CLIENTE_COOKIE)?.value;
  const stateCookie = request.cookies.get(SHOPEE_STATE_COOKIE)?.value;

  if (!clienteId) {
    return redirectClientes(request, { error: "missing-cliente" });
  }
  if (!state || !stateCookie || state !== stateCookie) {
    return redirectClientes(request, { error: "invalid-state" });
  }
  if (!code) {
    return redirectClientes(request, { error: "missing-code" });
  }

  const shopId = Number(shopIdParam);
  if (!shopIdParam || !Number.isFinite(shopId) || shopId <= 0) {
    return redirectClientes(request, { error: "missing-shop-id" });
  }

  const context = await getCurrentUserContext();
  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return redirectClientes(request, { error: "forbidden" });
  }

  const cliente = await resolveClienteForWorkspace({
    clienteId,
    workspaceId: context.currentWorkspace.id,
  });
  if (!cliente) {
    return redirectClientes(request, { error: "cliente-not-found" });
  }

  const config = getShopeeEnvConfig();
  if (!config) {
    return redirectClientes(request, { error: "missing-shopee-config" });
  }

  const client = new ShopeeClient({ config });
  const token = await client.exchangeCodeForAccessToken({ code, shopId });
  const tokenFields = encryptClienteTokens({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
  });

  await prisma.clienteConnection.upsert({
    where: {
      clienteId_platform: {
        clienteId: cliente.id,
        platform: PublisherPlatform.SHOPEE,
      },
    },
    update: {
      ...tokenFields,
      externalId: String(token.shopId),
      expiresAt: new Date(Date.now() + token.expiresIn * 1000),
    },
    create: {
      clienteId: cliente.id,
      platform: PublisherPlatform.SHOPEE,
      ...tokenFields,
      externalId: String(token.shopId),
      expiresAt: new Date(Date.now() + token.expiresIn * 1000),
    },
  });

  return redirectClientes(request, { connected: "shopee" });
}
