// The "Conectar" buttons are intentional full-page navigations to /api/auth/*
// OAuth initiators (they 302 to Shopee/Mercado Livre), not client-side page
// links, so they use a plain <a> rather than next/link.
import { PublisherPlatform } from "@prisma/client";
import { CheckCircle2, CircleAlert, Store, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { prisma } from "@/lib/db/prisma";

import { DisconnectButton, NovoClienteForm } from "./clientes-client";

export const dynamic = "force-dynamic";

type ClientesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function connectedLabel(connected: string | undefined) {
  if (connected === "shopee") return "Conta Shopee conectada com sucesso.";
  if (connected === "ml") return "Conta Mercado Livre conectada com sucesso.";
  return null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-cliente": "Selecione um cliente antes de conectar.",
  "cliente-not-found": "Cliente não encontrado neste workspace.",
  forbidden: "Você não tem permissão para conectar contas.",
  "missing-shopee-config": "Credenciais Shopee não configuradas no ambiente.",
  "missing-ml-config":
    "Credenciais Mercado Livre não configuradas no ambiente.",
  "invalid-state": "Sessão de conexão expirada. Tente novamente.",
  "missing-code": "Retorno de autorização inválido.",
  "missing-shop-id": "Shopee não retornou o identificador da loja.",
  "oauth-failed": "Falha na conexão. Tente novamente.",
};

function errorMessage(error: string | undefined) {
  if (!error) return null;
  return ERROR_MESSAGES[error] ?? "Falha na conexão. Tente novamente.";
}

export default async function ClientesPage({
  searchParams,
}: ClientesPageProps) {
  const params = await searchParams;
  const context = await getCurrentUserContext();
  const canOperate = canOperateWorkspaceConnectors(
    context.user,
    context.currentMembership.role,
  );

  const clientes = await prisma.cliente.findMany({
    where: { workspaceId: context.currentWorkspace.id },
    orderBy: { createdAt: "desc" },
    include: {
      connections: { select: { platform: true, externalId: true } },
    },
  });

  const successMessage = connectedLabel(firstParam(params.connected));
  const failureMessage = errorMessage(firstParam(params.error));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Publicador</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Clientes
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Gerencie as contas de marketplace conectadas por cliente.
        </p>
      </div>

      {successMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      {failureMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          <span>{failureMessage}</span>
        </div>
      ) : null}

      {canOperate ? (
        <Card>
          <CardHeader>
            <CardTitle>Adicionar cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <NovoClienteForm />
          </CardContent>
        </Card>
      ) : null}

      {clientes.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Users
                aria-hidden
                className="size-6 text-[var(--text-tertiary)]"
              />
              <p className="text-sm text-[var(--text-secondary)]">
                Nenhum cliente cadastrado ainda.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {clientes.map((cliente) => {
            const shopee = cliente.connections.find(
              (connection) => connection.platform === PublisherPlatform.SHOPEE,
            );
            const ml = cliente.connections.find(
              (connection) =>
                connection.platform === PublisherPlatform.MERCADO_LIVRE,
            );

            return (
              <Card key={cliente.id}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Store
                      aria-hidden
                      className="size-4 text-[var(--text-tertiary)]"
                    />
                    <span className="text-base font-semibold text-[var(--text-primary)]">
                      {cliente.nome}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <PlatformRow
                      canOperate={canOperate}
                      clienteId={cliente.id}
                      connectHref={`/api/auth/shopee?cliente_id=${cliente.id}`}
                      connected={Boolean(shopee)}
                      externalId={shopee?.externalId ?? null}
                      platform="shopee"
                      title="Shopee"
                    />
                    <PlatformRow
                      canOperate={canOperate}
                      clienteId={cliente.id}
                      connectHref={`/api/auth/ml?cliente_id=${cliente.id}`}
                      connected={Boolean(ml)}
                      externalId={ml?.externalId ?? null}
                      platform="ml"
                      title="Mercado Livre"
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlatformRow({
  canOperate,
  clienteId,
  connectHref,
  connected,
  externalId,
  platform,
  title,
}: {
  canOperate: boolean;
  clienteId: string;
  connectHref: string;
  connected: boolean;
  externalId: string | null;
  platform: "shopee" | "ml";
  title: string;
}) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </span>
        <span
          className={
            connected
              ? "inline-flex items-center gap-1 text-xs font-medium text-[var(--success)]"
              : "text-xs font-medium text-[var(--text-tertiary)]"
          }
        >
          {connected ? (
            <>
              <CheckCircle2 aria-hidden className="size-3.5" />
              Conectado
            </>
          ) : (
            "Desconectado"
          )}
        </span>
      </div>
      {connected && externalId ? (
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          ID: {externalId}
        </p>
      ) : null}
      {canOperate ? (
        <div className="mt-3">
          {connected ? (
            <DisconnectButton
              clienteId={clienteId}
              label="Desconectar"
              platform={platform}
            />
          ) : (
            <a
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--w3-red)] px-4 py-2 text-sm font-semibold text-[var(--text-on-red)] transition-colors duration-200 hover:bg-[var(--w3-red-hover)] md:min-h-9"
              href={connectHref}
            >
              Conectar {title}
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
