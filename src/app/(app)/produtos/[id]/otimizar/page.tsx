import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";
import {
  calcularScore,
  type ScoreCriterion,
} from "@/lib/publisher/listing-score";

import { OtimizarClient } from "./otimizar-client";

export const dynamic = "force-dynamic";

type OtimizarPageProps = {
  params: Promise<{ id: string }>;
};

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== null && v !== undefined) out[k] = String(v);
  }
  return out;
}

export default async function OtimizarPage({ params }: OtimizarPageProps) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  const produto = await prisma.produto.findFirst({
    where: { id, cliente: { workspaceId: context.currentWorkspace.id } },
    select: {
      id: true,
      clienteId: true,
      nomeOriginal: true,
      fotoUrl: true,
      imagens: true,
      tituloMl: true,
      tituloShopee: true,
      descricao: true,
      categoriaMlId: true,
      categoriaShopeeId: true,
      atributos: true,
      preco: true,
      quantidade: true,
      condicao: true,
      pesoGramas: true,
      comprimentoCm: true,
      larguraCm: true,
      alturaCm: true,
      score: true,
      updatedAt: true,
      cliente: { select: { nome: true } },
    },
  });

  if (!produto) notFound();

  const imagens = Array.from(
    new Set(
      [
        ...(produto.fotoUrl ? [produto.fotoUrl] : []),
        ...produto.imagens,
      ].filter(Boolean),
    ),
  );

  // Score ao vivo (não confia no persistido, que pode estar defasado).
  const { score, breakdown } = calcularScore({
    tituloMl: produto.tituloMl,
    tituloShopee: produto.tituloShopee,
    descricao: produto.descricao,
    imagens,
    atributos: produto.atributos,
    categoriaMlId: produto.categoriaMlId,
    categoriaShopeeId: produto.categoriaShopeeId,
    preco: Number(produto.preco),
    quantidade: produto.quantidade,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href="/produtos">
            <ArrowLeft aria-hidden className="size-4" />
            Produtos
          </Link>
        </Button>
      </div>
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">
          Otimização de anúncio · {produto.cliente.nome}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">
          {produto.nomeOriginal}
        </h2>
      </div>

      <OtimizarClient
        produtoId={produto.id}
        clienteId={produto.clienteId}
        syncKey={produto.updatedAt.toISOString()}
        initialScore={score}
        breakdown={breakdown as ScoreCriterion[]}
        initial={{
          nomeOriginal: produto.nomeOriginal,
          imagens,
          fotoUrl: produto.fotoUrl,
          tituloMl: produto.tituloMl ?? "",
          tituloShopee: produto.tituloShopee ?? "",
          descricao: produto.descricao ?? "",
          categoriaMlId: produto.categoriaMlId ?? "",
          categoriaShopeeId: produto.categoriaShopeeId,
          atributos: toStringRecord(produto.atributos),
          preco: Number(produto.preco),
          quantidade: produto.quantidade,
          condicao: produto.condicao,
          pesoGramas: produto.pesoGramas,
          comprimentoCm: produto.comprimentoCm,
          larguraCm: produto.larguraCm,
          alturaCm: produto.alturaCm,
        }}
      />
    </div>
  );
}
