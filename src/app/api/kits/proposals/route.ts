import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import { ensureDerivedProduto } from "@/lib/kits/derived-product";
import {
  requireClienteInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

const listSchema = z.object({
  clienteId: z.string().trim().min(1).optional(),
  status: z
    .enum(["proposta", "aprovado", "rejeitado", "bloqueado"])
    .optional(),
});

const decisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("approve"),
      proposalId: z.string().trim().min(1),
      price: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      proposalId: z.string().trim().min(1),
    })
    .strict(),
]);

type ProductRow = {
  id: string;
  quantidade: number;
  shopeeItemId: string | null;
  mlItemId: string | null;
};

function statusWhere(
  status: z.infer<typeof listSchema>["status"],
): Prisma.KitProposalWhereInput {
  if (status === "proposta") return { status: "proposta" };
  if (status === "rejeitado") return { status: "rejeitada" };
  if (status === "aprovado") return { kit: { is: { status: "aprovado" } } };
  if (status === "bloqueado") return { kit: { is: { status: "bloqueado" } } };
  return {};
}

function publicStatus(proposal: {
  status: string;
  kit: { status: string } | null;
}) {
  if (proposal.status === "rejeitada") return "rejeitado";
  if (proposal.kit) return proposal.kit.status;
  if (proposal.status === "aprovada") return "aprovado";
  return "proposta";
}

function externalIds(product: ProductRow): string[] {
  return [product.shopeeItemId, product.mlItemId].filter(
    (id): id is string => Boolean(id),
  );
}

async function hasInsufficientStock(input: {
  workspaceId: string;
  clienteId: string;
  componentIds: string[];
  minStock?: number;
}) {
  const componentIds = [...new Set(input.componentIds)];
  const products = await prisma.produto.findMany({
    where: { id: { in: componentIds }, clienteId: input.clienteId },
    select: {
      id: true,
      quantidade: true,
      shopeeItemId: true,
      mlItemId: true,
    },
  });
  if (products.length !== componentIds.length) return true;

  const productExternalIds = [...new Set(products.flatMap(externalIds))];
  const inventoryRows = productExternalIds.length
    ? await prisma.productInventory.findMany({
        where: {
          workspaceId: input.workspaceId,
          externalProductId: { in: productExternalIds },
        },
        select: {
          externalProductId: true,
          quantity: true,
          syncedAt: true,
        },
        orderBy: { syncedAt: "desc" },
      })
    : [];
  const inventoryByExternalId = new Map<string, number | null>();
  for (const row of inventoryRows) {
    if (!inventoryByExternalId.has(row.externalProductId)) {
      inventoryByExternalId.set(row.externalProductId, row.quantity);
    }
  }

  const minStock = input.minStock ?? 2;
  return products.some((product) => {
    const liveQuantity = externalIds(product)
      .map((id) => inventoryByExternalId.get(id))
      .find((quantity) => quantity !== undefined);
    const stock =
      liveQuantity === null
        ? Number.MAX_SAFE_INTEGER
        : (liveQuantity ?? product.quantidade);
    return stock < minStock;
  });
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const parsed = listSchema.safeParse({
      clienteId: request.nextUrl.searchParams.get("clienteId") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Filtros inválidos" },
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

    const proposals = await prisma.kitProposal.findMany({
      where: {
        cliente: { workspaceId: guard.workspaceId },
        ...(parsed.data.clienteId
          ? { clienteId: parsed.data.clienteId }
          : {}),
        ...statusWhere(parsed.data.status),
      },
      select: {
        id: true,
        clienteId: true,
        componentIds: true,
        reason: true,
        monochromatic: true,
        status: true,
        cliente: { select: { id: true, nome: true } },
        kit: {
          select: {
            id: true,
            status: true,
            price: true,
            produtoId: true,
            produto: { select: { categoriaShopeeId: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const componentIds = [
      ...new Set(proposals.flatMap((proposal) => proposal.componentIds)),
    ];
    const products = componentIds.length
      ? await prisma.produto.findMany({
          where: {
            id: { in: componentIds },
            cliente: { workspaceId: guard.workspaceId },
          },
          select: {
            id: true,
            nomeOriginal: true,
            fotoUrl: true,
            preco: true,
          },
        })
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));

    return NextResponse.json({
      success: true,
      data: {
        proposals: proposals.map((proposal) => {
          const components = proposal.componentIds.flatMap((id) => {
            const product = productById.get(id);
            return product
              ? [
                  {
                    id: product.id,
                    name: product.nomeOriginal,
                    imageUrl: product.fotoUrl,
                    price: Number(product.preco),
                  },
                ]
              : [];
          });
          return {
            id: proposal.id,
            clienteId: proposal.clienteId,
            cliente: proposal.cliente,
            componentIds: proposal.componentIds,
            components,
            reason: proposal.reason,
            monochromatic: proposal.monochromatic,
            status: publicStatus(proposal),
            suggestedPrice: components.reduce(
              (total, component) => total + component.price,
              0,
            ),
            kit: proposal.kit
              ? {
                  id: proposal.kit.id,
                  status: proposal.kit.status,
                  price: Number(proposal.kit.price),
                  produtoId: proposal.kit.produtoId,
                  categoryPending:
                    proposal.kit.produtoId !== null &&
                    proposal.kit.produto?.categoriaShopeeId == null,
                }
              : null,
          };
        }),
      },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/kits/proposals] list failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao listar propostas" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = decisionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Decisão inválida" },
        { status: 400 },
      );
    }

    const proposal = await prisma.kitProposal.findFirst({
      where: {
        id: parsed.data.proposalId,
        cliente: { workspaceId: guard.workspaceId },
      },
      select: {
        id: true,
        clienteId: true,
        componentIds: true,
      },
    });
    if (!proposal) {
      return NextResponse.json(
        { success: false, error: "Proposta não encontrada" },
        { status: 404 },
      );
    }

    if (parsed.data.action === "reject") {
      const rejected = await prisma.kitProposal.update({
        where: { id: proposal.id },
        data: { status: "rejeitada" },
        select: { id: true, status: true },
      });
      return NextResponse.json({
        success: true,
        data: { proposal: rejected },
      });
    }

    const blocked = await hasInsufficientStock({
      workspaceId: guard.workspaceId,
      clienteId: proposal.clienteId,
      componentIds: proposal.componentIds,
    });
    const price = parsed.data.price;
    const kitStatus = blocked ? "bloqueado" : "aprovado";
    const kit = await prisma.$transaction(async (tx) => {
      await tx.kitProposal.update({
        where: { id: proposal.id },
        data: { status: "aprovada" },
      });
      return tx.kit.upsert({
        where: { proposalId: proposal.id },
        create: {
          proposalId: proposal.id,
          clienteId: proposal.clienteId,
          price,
          status: kitStatus,
        },
        update: { price, status: kitStatus },
        select: { id: true, status: true, price: true },
      });
    });
    const produto = await ensureDerivedProduto({
      kitId: kit.id,
      workspaceId: guard.workspaceId,
    });

    return NextResponse.json({
      success: true,
      data: {
        kit: {
          id: kit.id,
          status: kit.status,
          price: Number(kit.price),
          produtoId: produto.id,
          categoryPending: produto.categoriaShopeeId === null,
        },
      },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/kits/proposals] decision failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao atualizar proposta" },
      { status: 500 },
    );
  }
}
