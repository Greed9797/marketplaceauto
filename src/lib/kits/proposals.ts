import { createHash } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import {
  buildProposals,
  type EngineAgeBand,
  type EngineGender,
  type EngineProduct,
} from "@/lib/kits/engine";

function canonicalComponentIds(componentIds: string[]): string[] {
  return [...new Set(componentIds)].sort();
}

export function buildComboHash(componentIds: string[]): string {
  return createHash("sha256")
    .update(canonicalComponentIds(componentIds).join("\u0000"))
    .digest("hex");
}

function isEngineGender(value: string): value is EngineGender {
  return value === "feminino" || value === "masculino" || value === "unissex";
}

function isEngineAgeBand(value: string): value is EngineAgeBand {
  return value === "adulto" || value === "infantil";
}

function productExternalIds(product: {
  shopeeItemId: string | null;
  mlItemId: string | null;
}): string[] {
  return [product.shopeeItemId, product.mlItemId].filter((id): id is string =>
    Boolean(id),
  );
}

export async function generateProposals(clienteId: string): Promise<number> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { workspaceId: true },
  });
  if (!cliente) throw new Error("Cliente não encontrado.");

  const [produtos, complementaryPairs, rejectedRows] = await Promise.all([
    prisma.produto.findMany({
      where: {
        clienteId,
        status: "publicado",
        classification: { is: { needsReview: false } },
      },
      select: {
        id: true,
        mlItemId: true,
        shopeeItemId: true,
        preco: true,
        quantidade: true,
        classification: {
          select: {
            gender: true,
            ageBand: true,
            categoryKey: true,
            colorPattern: true,
          },
        },
      },
      orderBy: { id: "asc" },
    }),
    prisma.complementaryPair.findMany({
      where: { active: true },
      select: { categoryA: true, categoryB: true, active: true },
    }),
    prisma.kitProposal.findMany({
      where: { clienteId, status: "rejeitada" },
      select: { comboHash: true },
    }),
  ]);

  const externalIds = [...new Set(produtos.flatMap(productExternalIds))];
  const inventoryRows = externalIds.length
    ? await prisma.productInventory.findMany({
        where: {
          workspaceId: cliente.workspaceId,
          externalProductId: { in: externalIds },
        },
        select: { externalProductId: true, sku: true, quantity: true },
        orderBy: { syncedAt: "desc" },
      })
    : [];

  const inventoryByExternalId = new Map<
    string,
    (typeof inventoryRows)[number]
  >();
  for (const row of inventoryRows) {
    if (!inventoryByExternalId.has(row.externalProductId)) {
      inventoryByExternalId.set(row.externalProductId, row);
    }
  }

  const candidateSkus = [
    ...new Set(
      inventoryRows
        .map((row) => row.sku)
        .filter((sku): sku is string => Boolean(sku)),
    ),
  ];
  const salesRows = candidateSkus.length
    ? await prisma.ecommerceOrderItem.groupBy({
        by: ["sku"],
        where: { workspaceId: cliente.workspaceId, sku: { in: candidateSkus } },
        _sum: { quantity: true },
      })
    : [];
  const soldBySku = new Map<string, number>();
  for (const row of salesRows) {
    if (row.sku) soldBySku.set(row.sku, row._sum.quantity ?? 0);
  }

  const engineProducts: EngineProduct[] = produtos.flatMap((produto) => {
    const classification = produto.classification;
    if (
      !classification ||
      !isEngineGender(classification.gender) ||
      !isEngineAgeBand(classification.ageBand)
    ) {
      return [];
    }

    const ids = productExternalIds(produto);
    const inventory = ids
      .map((id) => inventoryByExternalId.get(id))
      .find((row) => row !== undefined);
    const externalItemId = inventory?.externalProductId ?? ids[0] ?? null;
    const salesVelocity = inventory?.sku
      ? (soldBySku.get(inventory.sku) ?? null)
      : null;
    const stock = inventory
      ? (inventory.quantity ?? Number.MAX_SAFE_INTEGER)
      : produto.quantidade;

    return [
      {
        id: produto.id,
        gender: classification.gender,
        ageBand: classification.ageBand,
        categoryKey: classification.categoryKey,
        colorPattern: classification.colorPattern,
        externalItemId,
        stock,
        price: Number(produto.preco),
        salesVelocity,
      },
    ];
  });

  const rejectedHashes = new Set(rejectedRows.map((row) => row.comboHash));
  const proposalRows = buildProposals({
    products: engineProducts,
    complementaryPairs,
  })
    .map((proposal) => {
      const componentIds = canonicalComponentIds(proposal.componentIds);
      return {
        clienteId,
        componentIds,
        reason: proposal.reason,
        comboHash: buildComboHash(componentIds),
        monochromatic: proposal.monochromatic,
        status: "proposta",
      };
    })
    .filter((proposal) => !rejectedHashes.has(proposal.comboHash));

  if (proposalRows.length === 0) return 0;

  const created = await prisma.kitProposal.createMany({
    data: proposalRows,
    skipDuplicates: true,
  });
  return created.count;
}
