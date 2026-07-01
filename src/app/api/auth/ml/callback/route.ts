import { PublisherPlatform } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import { encryptClienteTokens } from "@/lib/publisher/cliente-tokens";
import { getMlEnvConfig } from "@/lib/publisher/ml-env-config";
import {
  clearOAuthCookie,
  ML_CLIENTE_COOKIE,
  ML_STATE_COOKIE,
} from "@/lib/publisher/oauth-cookies";

export const runtime = "nodejs";

function redirectClientes(
  request: NextRequest,
  params: Record<string, string>,
) {
  const url = new URL("/clientes", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  clearOAuthCookie(response, ML_CLIENTE_COOKIE);
  clearOAuthCookie(response, ML_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    return await handleCallback(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[auth/ml/callback] failed: ${message}`);
    return redirectClientes(request, { error: "oauth-failed" });
  }
}

async function handleCallback(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const clienteId = request.cookies.get(ML_CLIENTE_COOKIE)?.value;
  const stateCookie = request.cookies.get(ML_STATE_COOKIE)?.value;

  if (!clienteId) {
    return redirectClientes(request, { error: "missing-cliente" });
  }
  if (!state || !stateCookie || state !== stateCookie) {
    return redirectClientes(request, { error: "invalid-state" });
  }
  if (!code) {
    return redirectClientes(request, { error: "missing-code" });
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

  const config = getMlEnvConfig();
  if (!config) {
    return redirectClientes(request, { error: "missing-ml-config" });
  }

  const client = new MercadoLivreClient({ config });
  const token = await client.exchangeCodeForAccessToken(code);
  const sellerId = token.userId;
  if (!sellerId) {
    return redirectClientes(request, { error: "oauth-failed" });
  }

  const tokenFields = encryptClienteTokens({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
  });

  await prisma.clienteConnection.upsert({
    where: {
      clienteId_platform: {
        clienteId: cliente.id,
        platform: PublisherPlatform.MERCADO_LIVRE,
      },
    },
    update: {
      ...tokenFields,
      externalId: sellerId,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000),
    },
    create: {
      clienteId: cliente.id,
      platform: PublisherPlatform.MERCADO_LIVRE,
      ...tokenFields,
      externalId: sellerId,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000),
    },
  });

  return redirectClientes(request, { connected: "ml" });
}
