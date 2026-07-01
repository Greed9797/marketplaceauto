import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { buildShopeeOAuthUrl } from "@/lib/connectors/shopee/oauth";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import {
  SHOPEE_CLIENTE_COOKIE,
  SHOPEE_STATE_COOKIE,
  setOAuthCookie,
} from "@/lib/publisher/oauth-cookies";
import { getShopeeEnvConfig } from "@/lib/publisher/shopee-env-config";

export const runtime = "nodejs";

function redirectClientes(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/clientes", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  // Any transient throw must surface as a friendly /clientes redirect, not a 500.
  try {
    return await handleConnect(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[auth/shopee] start failed: ${message}`);
    return redirectClientes(request, { error: "oauth-failed" });
  }
}

async function handleConnect(request: NextRequest) {
  const clienteId = request.nextUrl.searchParams.get("cliente_id");
  if (!clienteId) {
    return redirectClientes(request, { error: "missing-cliente" });
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

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildShopeeOAuthUrl({ state, config }));
  setOAuthCookie(response, SHOPEE_CLIENTE_COOKIE, cliente.id);
  setOAuthCookie(response, SHOPEE_STATE_COOKIE, state);

  return response;
}
