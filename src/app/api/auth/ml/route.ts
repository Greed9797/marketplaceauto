import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildMercadoLivreOAuthUrl } from "@/lib/connectors/mercado-livre/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import { getMlEnvConfig } from "@/lib/publisher/ml-env-config";
import {
  clearOAuthCookie,
  ML_CLIENTE_COOKIE,
  ML_STATE_COOKIE,
  setOAuthCookie,
} from "@/lib/publisher/oauth-cookies";

export const runtime = "nodejs";

function redirectWithParams(
  request: NextRequest,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(path, request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

function redirectFail(request: NextRequest, params: Record<string, string>) {
  // Fluxo com cliente volta pra /clientes; fluxo do workspace (card de
  // Conectores, sem cliente_id) volta pra /connectors.
  const hasCliente = Boolean(request.nextUrl.searchParams.get("cliente_id"));
  return redirectWithParams(
    request,
    hasCliente ? "/clientes" : "/connectors",
    hasCliente ? params : { provider: "mercado_livre", ...params },
  );
}

export async function GET(request: NextRequest) {
  try {
    return await handleConnect(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[auth/ml] start failed: ${message}`);
    return redirectFail(request, { error: "oauth-failed" });
  }
}

async function handleConnect(request: NextRequest) {
  // cliente_id é OPCIONAL: com ele a conexão fica vinculada ao Cliente (fluxo
  // do publisher); sem ele é a conexão do workspace (botão Conectar do card).
  const clienteId = request.nextUrl.searchParams.get("cliente_id");

  const context = await getCurrentUserContext();
  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return redirectFail(request, { error: "forbidden" });
  }

  let cliente: Awaited<ReturnType<typeof resolveClienteForWorkspace>> = null;
  if (clienteId) {
    cliente = await resolveClienteForWorkspace({
      clienteId,
      workspaceId: context.currentWorkspace.id,
    });
    if (!cliente) {
      return redirectFail(request, { error: "cliente-not-found" });
    }
  }

  const config = getMlEnvConfig();
  if (!config) {
    return redirectFail(request, { error: "missing-ml-config" });
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(
    buildMercadoLivreOAuthUrl({ state, config }),
  );
  if (cliente) {
    setOAuthCookie(response, ML_CLIENTE_COOKIE, cliente.id);
  } else {
    // Cookie de um fluxo por-cliente abortado não pode vazar pra conexão de
    // workspace — o callback decide o vínculo pela presença desse cookie.
    clearOAuthCookie(response, ML_CLIENTE_COOKIE);
  }
  setOAuthCookie(response, ML_STATE_COOKIE, state);

  return response;
}
