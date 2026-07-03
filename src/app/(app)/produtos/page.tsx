import { ImageOff, Package, Plus } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";
import { statusTone } from "@/lib/publisher/status-display";
import { formatCurrencyBR } from "@/lib/utils/format-br";

import {
  ImportarAnunciosButton,
  ProdutoRowActions,
  ProdutosFilter,
} from "./produtos-client";

export const dynamic = "force-dynamic";

type ProdutosPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProdutosPage({
  searchParams,
}: ProdutosPageProps) {
  const params = await searchParams;
  const context = await getCurrentUserContext();
  const workspaceId = context.currentWorkspace.id;

  const clientes = await prisma.cliente.findMany({
    where: { workspaceId },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });

  const clienteFilter = firstParam(params.clienteId) ?? "";
  const clienteIds = clientes.map((cliente) => cliente.id);
  const scopedClienteId =
    clienteFilter && clienteIds.includes(clienteFilter) ? clienteFilter : null;

  const produtos = await prisma.produto.findMany({
    where: {
      cliente: { workspaceId },
      ...(scopedClienteId ? { clienteId: scopedClienteId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      nomeOriginal: true,
      fotoUrl: true,
      status: true,
      score: true,
      preco: true,
      cliente: { select: { nome: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Publicador</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Produtos
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Gerencie rascunhos e prepare anúncios para Shopee e Mercado Livre.
          </p>
        </div>
        <Button asChild>
          <Link href="/produtos/novo">
            <Plus aria-hidden className="size-4" />
            Novo produto
          </Link>
        </Button>
      </div>

      {clientes.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <ProdutosFilter clientes={clientes} selected={scopedClienteId ?? ""} />
          <ImportarAnunciosButton clienteId={scopedClienteId} />
        </div>
      ) : null}

      {clientes.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Package
                aria-hidden
                className="size-7 text-[var(--text-tertiary)]"
              />
              <p className="text-sm text-[var(--text-secondary)]">
                Cadastre um cliente antes de criar produtos.
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link href="/clientes">Ir para Clientes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : produtos.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Package
                aria-hidden
                className="size-7 text-[var(--text-tertiary)]"
              />
              <p className="text-sm text-[var(--text-secondary)]">
                Nenhum produto encontrado.
              </p>
              <Button asChild size="sm">
                <Link href="/produtos/novo">Criar primeiro produto</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {produtos.map((produto) => (
            <Card key={produto.id} className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  {produto.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`Foto de ${produto.nomeOriginal}`}
                      className="size-14 shrink-0 rounded-md border border-[var(--border-subtle)] object-cover"
                      src={produto.fotoUrl}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="grid size-14 shrink-0 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                    >
                      <ImageOff className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {produto.nomeOriginal}
                    </p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">
                      {produto.cliente.nome}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {formatCurrencyBR(Number(produto.preco))}
                      </span>
                      <Badge tone={statusTone(produto.status)}>
                        {produto.status}
                      </Badge>
                      {produto.score !== null ? (
                        <Badge
                          tone={
                            produto.score >= 80
                              ? "success"
                              : produto.score >= 50
                                ? "warning"
                                : "danger"
                          }
                        >
                          Score {produto.score}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
                  <Button asChild size="sm">
                    <Link href={`/produtos/${produto.id}/otimizar`}>
                      Otimizar
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/produtos/${produto.id}/editar`}>Editar</Link>
                  </Button>
                  <ProdutoRowActions produtoId={produto.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
