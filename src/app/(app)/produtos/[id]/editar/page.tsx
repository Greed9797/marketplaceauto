import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";
import { statusTone } from "@/lib/publisher/status-display";

import { ProdutoEditForm, type ProdutoEditData } from "./produto-edit-form";

export const dynamic = "force-dynamic";

type ProdutoEditarPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProdutoEditarPage({
  params,
}: ProdutoEditarPageProps) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  const produto = await prisma.produto.findFirst({
    where: { id, cliente: { workspaceId: context.currentWorkspace.id } },
    include: { cliente: { select: { nome: true } } },
  });

  if (!produto) notFound();

  const data: ProdutoEditData = {
    id: produto.id,
    clienteId: produto.clienteId,
    nomeOriginal: produto.nomeOriginal,
    fotoUrl: produto.fotoUrl ?? "",
    status: produto.status,
    tituloMl: produto.tituloMl ?? "",
    tituloShopee: produto.tituloShopee ?? "",
    descricao: produto.descricao ?? "",
    categoriaMlId: produto.categoriaMlId ?? "",
    categoriaShopeeId:
      produto.categoriaShopeeId !== null
        ? String(produto.categoriaShopeeId)
        : "",
    preco: String(produto.preco),
    quantidade: String(produto.quantidade),
    condicao: produto.condicao,
    atributos: produto.atributos
      ? JSON.stringify(produto.atributos, null, 2)
      : "",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Publicador</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Editar produto
          </h2>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span>{produto.cliente.nome}</span>
            <Badge tone={statusTone(produto.status)}>{produto.status}</Badge>
          </div>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/produtos">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardContent>
          <ProdutoEditForm produto={data} />
        </CardContent>
      </Card>
    </div>
  );
}
