import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import {
  requireClienteInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

const createProdutoSchema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório."),
  nomeOriginal: z.string().trim().min(1, "Nome do produto é obrigatório."),
  fotoUrl: z.string().url().optional().nullable(),
  status: z
    .enum(["rascunho", "pendente", "publicando", "publicado", "erro"])
    .default("rascunho"),
  tituloMl: z.string().trim().max(60).optional().nullable(),
  tituloShopee: z.string().trim().max(120).optional().nullable(),
  descricao: z.string().optional().nullable(),
  categoriaMlId: z.string().optional().nullable(),
  categoriaShopeeId: z.coerce.number().int().positive().optional().nullable(),
  preco: z.coerce.number().positive("Preço deve ser maior que zero."),
  quantidade: z.coerce.number().int().positive().default(1),
  condicao: z.enum(["new", "used", "not_specified"]).default("not_specified"),
  atributos: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const clienteId = request.nextUrl.searchParams.get("clienteId");
    if (!clienteId) {
      return NextResponse.json(
        { success: false, error: "clienteId é obrigatório." },
        { status: 400 },
      );
    }

    const cliente = await requireClienteInWorkspace({
      clienteId,
      workspaceId: guard.workspaceId,
    });
    if (!cliente.ok) return cliente.response;

    const produtos = await prisma.produto.findMany({
      where: { clienteId: cliente.clienteId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: produtos });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/produtos] list failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao listar produtos" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = createProdutoSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        },
        { status: 400 },
      );
    }

    const cliente = await requireClienteInWorkspace({
      clienteId: parsed.data.clienteId,
      workspaceId: guard.workspaceId,
    });
    if (!cliente.ok) return cliente.response;

    const produto = await prisma.produto.create({
      data: {
        clienteId: cliente.clienteId,
        nomeOriginal: parsed.data.nomeOriginal,
        fotoUrl: parsed.data.fotoUrl ?? null,
        status: parsed.data.status,
        tituloMl: parsed.data.tituloMl ?? null,
        tituloShopee: parsed.data.tituloShopee ?? null,
        descricao: parsed.data.descricao ?? null,
        categoriaMlId: parsed.data.categoriaMlId ?? null,
        categoriaShopeeId: parsed.data.categoriaShopeeId ?? null,
        preco: parsed.data.preco,
        quantidade: parsed.data.quantidade,
        condicao: parsed.data.condicao,
        atributos:
          (parsed.data.atributos as Prisma.InputJsonValue | undefined) ??
          undefined,
      },
    });

    return NextResponse.json({ success: true, data: produto }, { status: 201 });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/produtos] create failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao criar produto" },
      { status: 500 },
    );
  }
}
