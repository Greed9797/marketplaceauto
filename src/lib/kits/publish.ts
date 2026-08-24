import { prisma } from "@/lib/db/prisma";
import { publishProdutoToShopee } from "@/lib/publisher/shopee-publish";

export type PublishKitBatchResult = {
  publicado: number;
  erros: { kitId: string; error: string }[];
};

type ComponentStock = {
  id: string;
  quantidade: number;
  shopeeItemId: string | null;
  mlItemId: string | null;
};

class SafeKitPublishError extends Error {
  constructor(
    message: string,
    readonly markKitError = false,
  ) {
    super(message);
  }
}

function externalIds(component: ComponentStock): string[] {
  return [component.shopeeItemId, component.mlItemId].filter(
    (id): id is string => Boolean(id),
  );
}

function isDerivedProdutoComplete(produto: {
  tituloShopee: string | null;
  descricao: string | null;
  fotoUrl: string | null;
  imagens: string[];
  categoriaShopeeId: number | null;
  preco: unknown;
}) {
  return Boolean(
    produto.tituloShopee?.trim() &&
      produto.descricao?.trim() &&
      (produto.fotoUrl || produto.imagens.length > 0) &&
      produto.categoriaShopeeId !== null &&
      Number(produto.preco) > 0,
  );
}

async function hasInsufficientStock(input: {
  workspaceId: string;
  clienteId: string;
  componentIds: string[];
  minStock?: number;
}) {
  const componentIds = [...new Set(input.componentIds)];
  const components = await prisma.produto.findMany({
    where: { id: { in: componentIds }, clienteId: input.clienteId },
    select: {
      id: true,
      quantidade: true,
      shopeeItemId: true,
      mlItemId: true,
    },
  });
  if (components.length !== componentIds.length) {
    throw new SafeKitPublishError(
      "Componentes do kit não encontrados.",
      true,
    );
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
  const stockByExternalId = new Map<string, number | null>();
  for (const row of inventoryRows) {
    if (!stockByExternalId.has(row.externalProductId)) {
      stockByExternalId.set(row.externalProductId, row.quantity);
    }
  }

  const minStock = input.minStock ?? 2;
  return components.some((component) => {
    const live = externalIds(component)
      .map((id) => stockByExternalId.get(id))
      .find((quantity) => quantity !== undefined);
    const stock =
      live === null ? Number.MAX_SAFE_INTEGER : (live ?? component.quantidade);
    return stock < minStock;
  });
}

export async function publishKitBatch(input: {
  kitIds: string[];
  workspaceId: string;
}): Promise<PublishKitBatchResult> {
  const result: PublishKitBatchResult = { publicado: 0, erros: [] };

  for (const kitId of [...new Set(input.kitIds)]) {
    let shouldMarkError = false;
    try {
      const kit = await prisma.kit.findFirst({
        where: {
          id: kitId,
          cliente: { workspaceId: input.workspaceId },
        },
        select: {
          id: true,
          clienteId: true,
          status: true,
          shopeeItemId: true,
          produtoId: true,
          produto: {
            select: {
              id: true,
              clienteId: true,
              tituloShopee: true,
              descricao: true,
              fotoUrl: true,
              imagens: true,
              categoriaShopeeId: true,
              preco: true,
              quantidade: true,
              shopeeItemId: true,
            },
          },
          proposal: { select: { componentIds: true } },
        },
      });
      if (!kit) throw new SafeKitPublishError("Kit não encontrado.");

      const existingItemId = kit.shopeeItemId ?? kit.produto?.shopeeItemId;
      if (existingItemId) {
        await prisma.kit.update({
          where: { id: kit.id },
          data: { status: "publicado", shopeeItemId: existingItemId },
        });
        result.publicado += 1;
        continue;
      }
      if (kit.status !== "aprovado") {
        throw new SafeKitPublishError("Kit não está aprovado.");
      }
      if (
        !kit.produtoId ||
        !kit.produto ||
        kit.produto.clienteId !== kit.clienteId ||
        !isDerivedProdutoComplete(kit.produto)
      ) {
        throw new SafeKitPublishError(
          "Produto derivado incompleto para publicação.",
          true,
        );
      }

      const blocked = await hasInsufficientStock({
        workspaceId: input.workspaceId,
        clienteId: kit.clienteId,
        componentIds: kit.proposal.componentIds,
      });
      if (blocked) {
        await prisma.kit.update({
          where: { id: kit.id },
          data: { status: "bloqueado" },
        });
        result.erros.push({ kitId, error: "Estoque insuficiente." });
        continue;
      }

      shouldMarkError = true;
      const published = await publishProdutoToShopee({
        clienteId: kit.clienteId,
        produtoId: kit.produto.id,
      });
      await prisma.kit.update({
        where: { id: kit.id },
        data: {
          status: "publicado",
          shopeeItemId: String(published.itemId),
        },
      });
      result.publicado += 1;
    } catch (error: unknown) {
      const safeError =
        error instanceof SafeKitPublishError
          ? error.message
          : "Falha ao publicar na Shopee.";
      const markKitError =
        shouldMarkError ||
        (error instanceof SafeKitPublishError && error.markKitError);
      const message = error instanceof Error ? error.message : "unknown";
      console.error(`[kits/publish] ${kitId} failed: ${message}`);
      if (markKitError) {
        await prisma.kit
          .update({ where: { id: kitId }, data: { status: "erro" } })
          .catch((updateError: unknown) => {
            const updateMessage =
              updateError instanceof Error ? updateError.message : "unknown";
            console.error(
              `[kits/publish] ${kitId} status update failed: ${updateMessage}`,
            );
          });
      }
      result.erros.push({ kitId, error: safeError });
    }
  }

  return result;
}
