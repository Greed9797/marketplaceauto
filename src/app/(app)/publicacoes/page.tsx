import { PublisherPlatform } from "@prisma/client";
import { Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";
import {
  formatDateTimeBR,
  platformLabel,
  statusTone,
} from "@/lib/publisher/status-display";

import {
  PublicacoesFilters,
  RetryButton,
  type PublicacoesFilterState,
} from "./publicacoes-client";

export const dynamic = "force-dynamic";

type PublicacoesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toPlatform(value: string | undefined): PublisherPlatform | undefined {
  if (value === "SHOPEE") return PublisherPlatform.SHOPEE;
  if (value === "MERCADO_LIVRE") return PublisherPlatform.MERCADO_LIVRE;
  return undefined;
}

export default async function PublicacoesPage({
  searchParams,
}: PublicacoesPageProps) {
  const params = await searchParams;
  const context = await getCurrentUserContext();
  const workspaceId = context.currentWorkspace.id;

  const clientes = await prisma.cliente.findMany({
    where: { workspaceId },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });
  const clienteIds = new Set(clientes.map((cliente) => cliente.id));

  const clienteFilterRaw = firstParam(params.clienteId);
  const clienteFilter =
    clienteFilterRaw && clienteIds.has(clienteFilterRaw)
      ? clienteFilterRaw
      : "";
  const plataformaFilter = toPlatform(firstParam(params.plataforma));
  const statusFilter = firstParam(params.status) ?? "";

  const publicacoes = await prisma.publicacao.findMany({
    where: {
      produto: { cliente: { workspaceId } },
      ...(clienteFilter ? { clienteId: clienteFilter } : {}),
      ...(plataformaFilter ? { plataforma: plataformaFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      plataforma: true,
      status: true,
      erroMensagem: true,
      tentativa: true,
      createdAt: true,
      produto: {
        select: { nomeOriginal: true, cliente: { select: { nome: true } } },
      },
    },
  });

  const filterState: PublicacoesFilterState = {
    clienteId: clienteFilter,
    plataforma: firstParam(params.plataforma) ?? "",
    status: statusFilter,
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Publicador</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Publicações
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Acompanhe as tentativas de envio para cada marketplace.
        </p>
      </div>

      {clientes.length > 0 ? (
        <Card>
          <CardContent>
            <PublicacoesFilters clientes={clientes} value={filterState} />
          </CardContent>
        </Card>
      ) : null}

      {publicacoes.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Send
                aria-hidden
                className="size-7 text-[var(--text-tertiary)]"
              />
              <p className="text-sm text-[var(--text-secondary)]">
                Nenhuma publicação registrada ainda.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {publicacoes.map((publicacao) => (
            <Card key={publicacao.id} className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {publicacao.produto.nomeOriginal}
                  </p>
                  <p className="truncate text-xs text-[var(--text-tertiary)]">
                    {publicacao.produto.cliente.nome} ·{" "}
                    {formatDateTimeBR(publicacao.createdAt)}
                    {publicacao.tentativa > 1
                      ? ` · tentativa ${publicacao.tentativa}`
                      : ""}
                  </p>
                  {publicacao.status === "erro" && publicacao.erroMensagem ? (
                    <p className="mt-1.5 text-xs text-[var(--danger)]">
                      {publicacao.erroMensagem}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge tone="neutral">
                    {platformLabel(publicacao.plataforma)}
                  </Badge>
                  <Badge tone={statusTone(publicacao.status)}>
                    {publicacao.status}
                  </Badge>
                  {publicacao.status === "erro" ? (
                    <RetryButton publicacaoId={publicacao.id} />
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
