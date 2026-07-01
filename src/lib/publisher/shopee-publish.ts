import { Prisma, type ClienteConnection, type Produto } from "@prisma/client";

import { ShopeeClient } from "@/lib/connectors/shopee/client";
import type { ShopeeConfig } from "@/lib/connectors/shopee/oauth";
import { signShopRequest } from "@/lib/connectors/shopee/signer";
import { prisma } from "@/lib/db/prisma";

import {
  decryptClienteAccessToken,
  decryptClienteRefreshToken,
  encryptClienteTokens,
} from "./cliente-tokens";
import { getShopeeEnvConfig } from "./shopee-env-config";

/**
 * Refresh the access token this many seconds before it actually expires, so an
 * in-flight publish never races the expiry boundary. Mirrors the "auto" repo.
 */
const TOKEN_REFRESH_SKEW_SECONDS = 1800;

type ShopeeResolvedToken = {
  accessToken: string;
  shopId: number;
};

type ShopeeShopRequestInput = {
  config: ShopeeConfig;
  accessToken: string;
  shopId: number;
  apiPath: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string | number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Signed request to a Shopee shop-scoped endpoint. Uses the shop signature
 * scheme (`signShopRequest`) and the host from the env config. Kept local
 * because `ShopeeClient` only exposes shop *reads* (order sync) — publishing
 * needs POSTs to `product.*` / `media_space.*` that the client does not wrap.
 */
async function shopeeShopRequest(
  input: ShopeeShopRequestInput,
): Promise<unknown> {
  const method = input.method ?? "GET";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopRequest({
    partnerId: input.config.partnerId,
    partnerKey: input.config.partnerKey,
    apiPath: input.apiPath,
    timestamp,
    accessToken: input.accessToken,
    shopId: input.shopId,
  });

  const url = new URL(`${input.config.host}${input.apiPath}`);
  url.searchParams.set("partner_id", String(input.config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("shop_id", String(input.shopId));
  url.searchParams.set("sign", sign);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Shopee ${input.apiPath} HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  if (isRecord(data) && typeof data.error === "string" && data.error !== "") {
    throw new Error(`Shopee ${input.apiPath}: ${JSON.stringify(data)}`);
  }

  return data;
}

/** `logistics.get_channel_list` → first enabled channel id, or null. */
export async function getFirstEnabledLogisticId(input: {
  config: ShopeeConfig;
  accessToken: string;
  shopId: number;
}): Promise<number | null> {
  const data = await shopeeShopRequest({
    ...input,
    apiPath: "/api/v2/logistics/get_channel_list",
  });

  if (!isRecord(data)) return null;
  const response = data.response;
  if (!isRecord(response)) return null;
  const list = response.logistic_channel_list;
  if (!Array.isArray(list)) return null;

  for (const channel of list) {
    if (isRecord(channel) && channel.enabled === true) {
      const id = channel.logistic_channel_id;
      if (typeof id === "number") return id;
    }
  }

  return null;
}

/** `media_space.upload_image` → uploaded image id, or null on failure. */
export async function uploadShopeeImage(input: {
  config: ShopeeConfig;
  accessToken: string;
  shopId: number;
  imageUrl: string;
}): Promise<string | null> {
  const data = await shopeeShopRequest({
    config: input.config,
    accessToken: input.accessToken,
    shopId: input.shopId,
    apiPath: "/api/v2/media_space/upload_image",
    method: "POST",
    body: { image: input.imageUrl },
  });

  if (!isRecord(data)) return null;
  const response = data.response;
  if (!isRecord(response)) return null;
  const imageInfo = response.image_info;
  if (isRecord(imageInfo) && typeof imageInfo.image_id === "string") {
    return imageInfo.image_id;
  }

  return null;
}

/** `product.add_item` → created item id. Throws when Shopee omits it. */
export async function addShopeeItem(input: {
  config: ShopeeConfig;
  accessToken: string;
  shopId: number;
  payload: Record<string, unknown>;
}): Promise<number> {
  const data = await shopeeShopRequest({
    config: input.config,
    accessToken: input.accessToken,
    shopId: input.shopId,
    apiPath: "/api/v2/product/add_item",
    method: "POST",
    body: input.payload,
  });

  if (isRecord(data) && isRecord(data.response)) {
    const itemId = data.response.item_id;
    if (typeof itemId === "number") return itemId;
  }

  throw new Error(`Shopee não retornou item_id: ${JSON.stringify(data)}`);
}

/**
 * Builds the `product.add_item` payload from a `Produto`. Pure so it can be
 * unit-tested and reused by the (future) preview UI.
 */
export function buildShopeeAddItemPayload(input: {
  produto: Produto;
  logisticId: number;
  imageIds: string[];
}): Record<string, unknown> {
  const { produto } = input;
  const name = (produto.tituloShopee ?? produto.nomeOriginal).slice(0, 120);

  return {
    original_price: Number(produto.preco),
    description: produto.descricao ?? produto.nomeOriginal,
    weight: 0.5,
    item_name: name,
    item_status: "NORMAL",
    image: { image_id_list: input.imageIds },
    category_id: produto.categoriaShopeeId,
    attribute_list: [],
    logistic_info: [
      { logistic_id: input.logisticId, enabled: true, is_free: false },
    ],
  };
}

/**
 * Resolves a valid Shopee access token for a Cliente, refreshing (and
 * persisting) via `ShopeeClient` when the stored token is near expiry. Reuses
 * the shared AES-256-GCM token vault for decrypt/re-encrypt.
 */
async function resolveShopeeToken(input: {
  config: ShopeeConfig;
  connection: ClienteConnection;
}): Promise<ShopeeResolvedToken> {
  const { connection } = input;
  const shopId = Number(connection.externalId);
  if (!Number.isFinite(shopId) || shopId <= 0) {
    throw new Error("Conexão Shopee sem shop_id válido.");
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  const stillValid = expiresAt - Date.now() > TOKEN_REFRESH_SKEW_SECONDS * 1000;
  if (stillValid) {
    return {
      accessToken: decryptClienteAccessToken(connection),
      shopId,
    };
  }

  const refreshToken = decryptClienteRefreshToken(connection);
  if (!refreshToken) {
    throw new Error("Conexão Shopee sem refresh token — reconecte a conta.");
  }

  const client = new ShopeeClient({ config: input.config });
  const refreshed = await client.refreshAccessToken({ refreshToken, shopId });

  const encrypted = encryptClienteTokens({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? refreshToken,
  });

  await prisma.clienteConnection.update({
    where: { id: connection.id },
    data: {
      ...encrypted,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    },
  });

  return { accessToken: refreshed.accessToken, shopId };
}

type PublishResult = {
  produtoId: string;
  itemId: number;
};

/**
 * Publishes a `Produto` on Shopee for the given Cliente: resolves the token,
 * discovers logistics, uploads the image, builds + sends `product.add_item`,
 * then persists `shopeeItemId` / `payloadShopee` / status and writes a
 * `Publicacao` audit row. Any failure flips the product to `erro` and records
 * the error on the `Publicacao`.
 */
export async function publishProdutoToShopee(input: {
  clienteId: string;
  produtoId: string;
}): Promise<PublishResult> {
  const config = getShopeeEnvConfig();
  if (!config) {
    throw new Error("Credenciais Shopee não configuradas no ambiente.");
  }

  const produto = await prisma.produto.findFirst({
    where: { id: input.produtoId, clienteId: input.clienteId },
  });
  if (!produto) {
    throw new Error("Produto não encontrado.");
  }

  const connection = await prisma.clienteConnection.findUnique({
    where: {
      clienteId_platform: {
        clienteId: input.clienteId,
        platform: "SHOPEE",
      },
    },
  });
  if (!connection) {
    throw new Error("Conta Shopee não conectada para este cliente.");
  }

  await prisma.produto.update({
    where: { id: produto.id },
    data: { status: "publicando" },
  });

  try {
    if (produto.categoriaShopeeId === null) {
      throw new Error("Categoria Shopee obrigatória.");
    }

    const { accessToken, shopId } = await resolveShopeeToken({
      config,
      connection,
    });

    const logisticId = await getFirstEnabledLogisticId({
      config,
      accessToken,
      shopId,
    });
    if (logisticId === null) {
      throw new Error("Nenhuma logística Shopee ativa encontrada.");
    }

    const imageIds: string[] = [];
    if (produto.fotoUrl) {
      const imageId = await uploadShopeeImage({
        config,
        accessToken,
        shopId,
        imageUrl: produto.fotoUrl,
      });
      if (imageId) imageIds.push(imageId);
    }

    const payload = buildShopeeAddItemPayload({
      produto,
      logisticId,
      imageIds,
    });
    const itemId = await addShopeeItem({
      config,
      accessToken,
      shopId,
      payload,
    });

    await prisma.$transaction([
      prisma.produto.update({
        where: { id: produto.id },
        data: {
          shopeeItemId: String(itemId),
          payloadShopee: payload as Prisma.InputJsonValue,
          status: "publicado",
        },
      }),
      prisma.publicacao.create({
        data: {
          produtoId: produto.id,
          clienteId: input.clienteId,
          plataforma: "SHOPEE",
          status: "sucesso",
          respostaApi: { item_id: itemId },
        },
      }),
    ]);

    return { produtoId: produto.id, itemId };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha desconhecida ao publicar na Shopee.";

    await prisma.$transaction([
      prisma.produto.update({
        where: { id: produto.id },
        data: { status: "erro" },
      }),
      prisma.publicacao.create({
        data: {
          produtoId: produto.id,
          clienteId: input.clienteId,
          plataforma: "SHOPEE",
          status: "erro",
          erroMensagem: message,
          respostaApi: { error: message },
        },
      }),
    ]);

    throw error;
  }
}
