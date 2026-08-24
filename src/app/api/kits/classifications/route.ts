import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import {
  requireClienteInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

const listSchema = z.object({
  clienteId: z.string().trim().min(1).optional(),
});

const manualClassificationSchema = z
  .object({
    produtoId: z.string().trim().min(1),
    gender: z.enum(["feminino", "masculino", "unissex"]),
    ageBand: z.enum(["adulto", "infantil"]),
    categoryKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .transform((value) => value.toLowerCase()),
    colorPattern: z
      .union([z.string().trim().max(80), z.null()])
      .transform((value) => (value === "" ? null : value)),
  })
  .strict();

const classificationSelect = {
  produtoId: true,
  gender: true,
  ageBand: true,
  categoryKey: true,
  colorPattern: true,
  confidence: true,
  source: true,
  needsReview: true,
  reviewedAt: true,
} as const;

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const parsed = listSchema.safeParse({
      clienteId: request.nextUrl.searchParams.get("clienteId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Filtro inválido" },
        { status: 400 },
      );
    }

    if (parsed.data.clienteId) {
      const cliente = await requireClienteInWorkspace({
        clienteId: parsed.data.clienteId,
        workspaceId: guard.workspaceId,
      });
      if (!cliente.ok) return cliente.response;
    }

    const classifications = await prisma.productClassification.findMany({
      where: {
        needsReview: true,
        produto: {
          cliente: { workspaceId: guard.workspaceId },
          ...(parsed.data.clienteId
            ? { clienteId: parsed.data.clienteId }
            : {}),
        },
      },
      select: {
        ...classificationSelect,
        produto: {
          select: {
            id: true,
            nomeOriginal: true,
            cliente: { select: { id: true, nome: true } },
          },
        },
      },
      orderBy: { updatedAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      data: { classifications },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/kits/classifications] list failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao listar classificações" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = manualClassificationSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Classificação inválida" },
        { status: 400 },
      );
    }

    const produto = await prisma.produto.findFirst({
      where: {
        id: parsed.data.produtoId,
        cliente: { workspaceId: guard.workspaceId },
      },
      select: { id: true },
    });
    if (!produto) {
      return NextResponse.json(
        { success: false, error: "Produto não encontrado" },
        { status: 404 },
      );
    }

    const reviewedAt = new Date();
    const manualData = {
      gender: parsed.data.gender,
      ageBand: parsed.data.ageBand,
      categoryKey: parsed.data.categoryKey,
      colorPattern: parsed.data.colorPattern,
      confidence: 1,
      source: "manual",
      needsReview: false,
      reviewedAt,
    };
    const classification = await prisma.productClassification.upsert({
      where: { produtoId: produto.id },
      create: { produtoId: produto.id, ...manualData },
      update: manualData,
      select: classificationSelect,
    });

    return NextResponse.json({
      success: true,
      data: { classification },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/kits/classifications] update failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao salvar classificação" },
      { status: 500 },
    );
  }
}
