import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildMercadoLivreOAuthUrl } from "@/lib/connectors/mercado-livre/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import { getMlEnvConfig } from "@/lib/publisher/ml-env-config";
import {
  ML_CLIENTE_COOKIE,
  ML_STATE_COOKIE,
  setOAuthCookie,
} from "@/lib/publisher/oauth-cookies";

export const runtime = "nodejs";

function redirectClientes(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/clientes", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    return await handleConnect(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[auth/ml] start failed: ${message}`);
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

  const config = getMlEnvConfig();
  if (!config) {
    return redirectClientes(request, { error: "missing-ml-config" });
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(
    buildMercadoLivreOAuthUrl({ state, config }),
  );
  setOAuthCookie(response, ML_CLIENTE_COOKIE, cliente.id);
  setOAuthCookie(response, ML_STATE_COOKIE, state);

  return response;
}
