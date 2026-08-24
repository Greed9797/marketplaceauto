import type { Produto } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

type Component = {
  id: string;
  nomeOriginal: string;
  tituloShopee: string | null;
  fotoUrl: string | null;
  imagens: string[];
  categoriaShopeeId: number | null;
  quantidade: number;
  shopeeItemId: string | null;
  mlItemId: string | null;
};

function externalIds(component: Component): string[] {
  return [component.shopeeItemId, component.mlItemId].filter(
    (id): id is string => Boolean(id),
  );
}

function commonShopeeCategory(components: Component[]): number | null {
  const first = components[0]?.categoriaShopeeId;
  if (
    first == null ||
    components.some((component) => component.categoriaShopeeId !== first)
  ) {
    return null;
  }
  return first;
}

function componentName(component: Component): string {
  return component.tituloShopee?.trim() || component.nomeOriginal.trim();
}

export async function ensureDerivedProduto(input: {
  kitId: string;
  workspaceId: string;
}): Promise<Produto> {
  const kit = await prisma.kit.findFirst({
    where: {
      id: input.kitId,
      cliente: { workspaceId: input.workspaceId },
    },
    select: {
      id: true,
      clienteId: true,
      price: true,
      produto: true,
      proposal: { select: { componentIds: true } },
    },
  });
  if (!kit) throw new Error("Kit não encontrado.");
  if (kit.produto) return kit.produto;

  const componentIds = [...new Set(kit.proposal.componentIds)];
  const rows = await prisma.produto.findMany({
    where: {
      id: { in: componentIds },
      clienteId: kit.clienteId,
      cliente: { workspaceId: input.workspaceId },
    },
    select: {
      id: true,
      nomeOriginal: true,
      tituloShopee: true,
      fotoUrl: true,
      imagens: true,
      categoriaShopeeId: true,
      quantidade: true,
      shopeeItemId: true,
      mlItemId: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const components = componentIds.flatMap((id) => {
    const component = byId.get(id);
    return component ? [component] : [];
  });
  if (components.length !== componentIds.length || components.length === 0) {
    throw new Error("Componentes do kit não encontrados.");
  }

  const allExternalIds = [...new Set(components.flatMap(externalIds))];
  const inventoryRows = allExternalIds.length
    ? await prisma.productInventory.findMany({
        where: {
          workspaceId: input.workspaceId,
          externalProductId: { in: allExternalIds },
        },
        select: {
          externalProductId: true,
          quantity: true,
          syncedAt: true,
        },
        orderBy: { syncedAt: "desc" },
      })
    : [];
  const liveStockByExternalId = new Map<string, number | null>();
  for (const row of inventoryRows) {
    if (!liveStockByExternalId.has(row.externalProductId)) {
      liveStockByExternalId.set(row.externalProductId, row.quantity);
    }
  }

  const names = components.map(componentName);
  const title = `Kit ${names.join(" + ")}`.slice(0, 120);
  const description = `Kit composto por:\n${names
    .map((name) => `- ${name}`)
    .join("\n")}`;
  const gallery = [
    ...new Set(
      components.flatMap((component) => [
        ...(component.fotoUrl ? [component.fotoUrl] : []),
        ...component.imagens,
      ]),
    ),
  ];
  const quantity = Math.min(
    ...components.map((component) => {
      const live = externalIds(component)
        .map((id) => liveStockByExternalId.get(id))
        .find((value) => value !== undefined);
      return Math.max(0, typeof live === "number" ? live : component.quantidade);
    }),
  );
  const data = {
    clienteId: kit.clienteId,
    nomeOriginal: title,
    tituloShopee: title,
    descricao: description,
    fotoUrl: gallery[0] ?? null,
    imagens: gallery,
    status: "rascunho",
    origem: "kit",
    categoriaShopeeId: commonShopeeCategory(components),
    preco: kit.price,
    quantidade: quantity,
  };

  return prisma.$transaction(async (tx) => {
    const current = await tx.kit.findUnique({
      where: { id: kit.id },
      select: { produtoId: true, produto: true },
    });
    if (!current) throw new Error("Kit não encontrado.");
    if (current.produto) return current.produto;

    const created = await tx.produto.create({ data });
    const linked = await tx.kit.updateMany({
      where: { id: kit.id, produtoId: null },
      data: { produtoId: created.id },
    });
    if (linked.count === 1) return created;

    await tx.produto.delete({ where: { id: created.id } });
    const winner = await tx.kit.findUnique({
      where: { id: kit.id },
      select: { produto: true },
    });
    if (!winner?.produto) {
      throw new Error("Falha ao relacionar Produto derivado.");
    }
    return winner.produto;
  });
}
