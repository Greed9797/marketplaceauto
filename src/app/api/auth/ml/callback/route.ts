import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { buildConnectorBackfillEvent } from "@/lib/connectors/backfill";
import { vaultCredentialFields } from "@/lib/connectors/credentials";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { isInngestConfigured } from "@/lib/connectors/inngest-config";
import { prisma } from "@/lib/db/prisma";
import { inngest } from "@/lib/jobs/inngest-client";
import { resolveClienteForWorkspace } from "@/lib/publisher/cliente-access";
import { getMlEnvConfig } from "@/lib/publisher/ml-env-config";
import {
  clearOAuthCookie,
  ML_CLIENTE_COOKIE,
  ML_STATE_COOKIE,
} from "@/lib/publisher/oauth-cookies";

export const runtime = "nodejs";

function redirectAfter(
  request: NextRequest,
  hasCliente: boolean,
  params: Record<string, string>,
) {
  // Fluxo por-cliente volta pra /clientes; fluxo do workspace (card de
  // Conectores, sem cookie de cliente) volta pra /connectors.
  const url = new URL(
    hasCliente ? "/clientes" : "/connectors",
    request.nextUrl.origin,
  );
  if (!hasCliente) url.searchParams.set("provider", "mercado_livre");
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
    const hasCliente = Boolean(request.cookies.get(ML_CLIENTE_COOKIE)?.value);
    return redirectAfter(request, hasCliente, { error: "oauth-failed" });
  }
}

async function handleCallback(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  // Cookie de cliente é OPCIONAL: presente = conexão vinculada ao Cliente
  // (fluxo do publisher); ausente = conexão do workspace (card de Conectores).
  const clienteId = request.cookies.get(ML_CLIENTE_COOKIE)?.value;
  const hasCliente = Boolean(clienteId);
  const stateCookie = request.cookies.get(ML_STATE_COOKIE)?.value;

  if (!state || !stateCookie || state !== stateCookie) {
    return redirectAfter(request, hasCliente, { error: "invalid-state" });
  }
  if (!code) {
    return redirectAfter(request, hasCliente, { error: "missing-code" });
  }

  const context = await getCurrentUserContext();
  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return redirectAfter(request, hasCliente, { error: "forbidden" });
  }

  const workspaceId = context.currentWorkspace.id;
  let cliente: Awaited<ReturnType<typeof resolveClienteForWorkspace>> = null;
  if (clienteId) {
    cliente = await resolveClienteForWorkspace({
      clienteId,
      workspaceId,
    });
    if (!cliente) {
      return redirectAfter(request, hasCliente, { error: "cliente-not-found" });
    }
  }

  const config = getMlEnvConfig();
  if (!config) {
    return redirectAfter(request, hasCliente, { error: "missing-ml-config" });
  }

  const client = new MercadoLivreClient({ config });
  const token = await client.exchangeCodeForAccessToken(code);
  const sellerId = token.userId;
  if (!sellerId) {
    return redirectAfter(request, hasCliente, { error: "oauth-failed" });
  }

  // Single source of truth: the publisher OAuth connection now lives on the
  // same ConnectorAccount that the order-sync/dashboard read, tied to the
  // Cliente via clienteId. Credentials use the shared vault envelope.
  const credentialFields = await vaultCredentialFields({
    workspaceId,
    provider: ConnectorProvider.MERCADO_LIVRE,
    externalAccountId: sellerId,
    credentials: { accessToken: token.accessToken },
    refreshToken: token.refreshToken,
    tokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
  });

  // Reject if this seller is already linked to a DIFFERENT cliente in the same
  // workspace: the upsert's unique key would otherwise silently reassign the
  // connection and break the first cliente's publish/order-sync.
  const existingSeller = await prisma.connectorAccount.findUnique({
    where: {
      workspaceId_provider_externalAccountId: {
        workspaceId,
        provider: ConnectorProvider.MERCADO_LIVRE,
        externalAccountId: sellerId,
      },
    },
    select: { clienteId: true },
  });
  if (
    cliente &&
    existingSeller?.clienteId &&
    existingSeller.clienteId !== cliente.id
  ) {
    return redirectAfter(request, hasCliente, { error: "shop-ja-conectado" });
  }

  const connectorAccount = await prisma.connectorAccount.upsert({
    where: {
      workspaceId_provider_externalAccountId: {
        workspaceId,
        provider: ConnectorProvider.MERCADO_LIVRE,
        externalAccountId: sellerId,
      },
    },
    update: {
      // Sem cliente (conexão de workspace) preserva um vínculo/nome existente —
      // reconectar pelo card não pode desassociar o Cliente do publisher.
      ...(cliente
        ? {
            clienteId: cliente.id,
            accountName: `${cliente.nome} — Mercado Livre`,
          }
        : {}),
      status: ConnectorStatus.ACTIVE,
      ...credentialFields,
      metadata: { scope: token.scope },
      lastSyncError: null,
    },
    create: {
      workspaceId,
      clienteId: cliente?.id ?? null,
      provider: ConnectorProvider.MERCADO_LIVRE,
      externalAccountId: sellerId,
      accountName: cliente
        ? `${cliente.nome} — Mercado Livre`
        : `Mercado Livre ${sellerId}`,
      status: ConnectorStatus.ACTIVE,
      ...credentialFields,
      metadata: { scope: token.scope },
    },
  });

  if (isInngestConfigured()) {
    await inngest.send(
      buildConnectorBackfillEvent({
        provider: ConnectorProvider.MERCADO_LIVRE,
        connectorAccountId: connectorAccount.id,
        scopes: token.scope,
      }),
    );
  }

  return redirectAfter(request, hasCliente, { connected: "ml" });
}
