import { ConnectorProvider, ConnectorStatus } from "@prisma/client";

import type { ListingDetail } from "@/lib/connectors/listing-detail";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { ShopeeClient } from "@/lib/connectors/shopee/client";
import { prisma } from "@/lib/db/prisma";
import { calcularScore } from "@/lib/publisher/listing-score";
import { getMlEnvConfig } from "@/lib/publisher/ml-env-config";
import { getShopeeEnvConfig } from "@/lib/publisher/shopee-env-config";
import { resolveMlToken } from "@/lib/publisher/ml-publish";
import { resolveShopeeToken } from "@/lib/publisher/shopee-publish";

export type ImportPlatform = "MERCADO_LIVRE" | "SHOPEE";

export type ImportResult = {
  imported: number;
  platform: ImportPlatform;
};

// Máximo de anúncios importados por chamada — mantém a rota abaixo do limite de
// tempo da função Vercel (cada item ML faz 1 chamada de descrição extra).
// ponytail: teto fixo; se lojas grandes precisarem, paginar por cursor depois.
const IMPORT_LISTING_CAP = 120;

/** Converte um ListingDetail no data de upsert do Produto (+ score). */
function produtoDataFromListing(
  listing: ListingDetail,
  platform: ImportPlatform,
) {
  const isMl = platform === "MERCADO_LIVRE";
  const nome = listing.title?.trim() || `Anúncio ${listing.externalId}`;
  const base = {
    nomeOriginal: nome,
    descricao: listing.description,
    imagens: listing.images,
    fotoUrl: listing.images[0] ?? null,
    atributos: listing.attributes,
    preco: listing.price ?? 0,
    quantidade: listing.availableQuantity ?? 0,
    status: "publicado",
    origem: isMl ? "importado_ml" : "importado_shopee",
    ...(isMl
      ? { tituloMl: nome, categoriaMlId: listing.categoryId }
      : {
          tituloShopee: nome,
          categoriaShopeeId: listing.categoryId
            ? Number(listing.categoryId)
            : null,
        }),
  };
  // Score determinístico a partir do estado importado.
  const { score, breakdown } = calcularScore({
    tituloMl: isMl ? nome : null,
    tituloShopee: isMl ? null : nome,
    descricao: listing.description,
    imagens: listing.images,
    atributos: listing.attributes,
    categoriaMlId: isMl ? listing.categoryId : null,
    categoriaShopeeId:
      !isMl && listing.categoryId ? Number(listing.categoryId) : null,
    preco: listing.price ?? 0,
    quantidade: listing.availableQuantity ?? 0,
  });
  return { ...base, score, scoreBreakdown: breakdown };
}

/**
 * Persiste os anúncios importados como `Produto`, upsert idempotente por
 * (clienteId + mlItemId/shopeeItemId): re-importar atualiza em vez de duplicar.
 */
async function persistListings(input: {
  clienteId: string;
  platform: ImportPlatform;
  listings: ListingDetail[];
}): Promise<number> {
  const isMl = input.platform === "MERCADO_LIVRE";
  let count = 0;
  for (const listing of input.listings) {
    const data = produtoDataFromListing(listing, input.platform);
    const idField = isMl
      ? { mlItemId: listing.externalId }
      : { shopeeItemId: listing.externalId };

    const existing = await prisma.produto.findFirst({
      where: { clienteId: input.clienteId, ...idField },
      select: { id: true },
    });

    if (existing) {
      await prisma.produto.update({ where: { id: existing.id }, data });
    } else {
      await prisma.produto.create({
        data: { clienteId: input.clienteId, ...idField, ...data },
      });
    }
    count += 1;
  }
  return count;
}

/** Conta ACTIVE do cliente para o provider, ou lança erro amigável. */
async function requireClienteAccount(
  clienteId: string,
  provider: ConnectorProvider,
) {
  const account = await prisma.connectorAccount.findFirst({
    where: { clienteId, provider, status: ConnectorStatus.ACTIVE },
  });
  if (!account) {
    const nome =
      provider === ConnectorProvider.MERCADO_LIVRE ? "Mercado Livre" : "Shopee";
    throw new Error(`Conta ${nome} não conectada para este cliente.`);
  }
  return account;
}

/**
 * Importa os anúncios existentes de um cliente (Mercado Livre ou Shopee) para
 * `Produto`, com imagens, ficha técnica, descrição e score. Reusa o token do
 * cliente (com refresh proativo) e é idempotente por item id.
 */
export async function importClienteListings(input: {
  clienteId: string;
  platform: ImportPlatform;
}): Promise<ImportResult> {
  if (input.platform === "MERCADO_LIVRE") {
    const config = getMlEnvConfig();
    if (!config) {
      throw new Error(
        "Credenciais Mercado Livre não configuradas no ambiente.",
      );
    }
    const account = await requireClienteAccount(
      input.clienteId,
      ConnectorProvider.MERCADO_LIVRE,
    );
    const accessToken = await resolveMlToken({ config, account });
    const client = new MercadoLivreClient({ config });
    const ids = (
      await client.listSellerItemIds({
        sellerId: account.externalAccountId,
        accessToken,
      })
    ).slice(0, IMPORT_LISTING_CAP);
    const listings = await client.fetchListingDetails({
      itemIds: ids,
      accessToken,
    });
    const imported = await persistListings({
      clienteId: input.clienteId,
      platform: input.platform,
      listings,
    });
    return { imported, platform: input.platform };
  }

  const config = getShopeeEnvConfig();
  if (!config) {
    throw new Error("Credenciais Shopee não configuradas no ambiente.");
  }
  const account = await requireClienteAccount(
    input.clienteId,
    ConnectorProvider.SHOPEE,
  );
  const { accessToken, shopId } = await resolveShopeeToken({ config, account });
  const client = new ShopeeClient({ config });
  const ids = (await client.listShopItemIds({ shopId, accessToken })).slice(
    0,
    IMPORT_LISTING_CAP,
  );
  const listings = await client.fetchListingDetails({
    shopId,
    accessToken,
    itemIds: ids,
  });
  const imported = await persistListings({
    clienteId: input.clienteId,
    platform: input.platform,
    listings,
  });
  return { imported, platform: input.platform };
}
