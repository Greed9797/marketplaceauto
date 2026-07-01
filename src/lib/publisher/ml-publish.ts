import {
  ConnectorProvider,
  ConnectorStatus,
  Prisma,
  type ConnectorAccount,
  type Produto,
} from "@prisma/client";

import {
  connectorAccessTokenFromAccount,
  connectorRefreshTokenFromAccount,
  vaultCredentialFields,
} from "@/lib/connectors/credentials";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import type { MercadoLivreConfig } from "@/lib/connectors/mercado-livre/oauth";
import { prisma } from "@/lib/db/prisma";

import { getMlEnvConfig } from "./ml-env-config";

/** Refresh the ML token this many seconds before expiry (tokens live ~6h). */
const TOKEN_REFRESH_SKEW_SECONDS = 1800;
/** Marketplace site for Brazil. */
const ML_SITE_ID = "MLB";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type MlRequestInput = {
  apiBaseUrl: string;
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: Record<string, unknown>;
};

/** Authenticated Mercado Livre REST call returning the parsed JSON body. */
async function mlRequest(input: MlRequestInput): Promise<unknown> {
  const response = await fetch(`${input.apiBaseUrl}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Mercado Livre ${input.path} HTTP ${response.status}: ${await response
        .text()
        .catch(() => "")}`,
    );
  }

  return response.json();
}

/**
 * Resolves a category id for the listing. Prefers an explicit `MLB...` category
 * on the product; otherwise queries `domain_discovery.search` using the title.
 */
export async function resolveMlCategoryId(input: {
  apiBaseUrl: string;
  accessToken: string;
  produto: Produto;
}): Promise<string | null> {
  if (input.produto.categoriaMlId?.startsWith("MLB")) {
    return input.produto.categoriaMlId;
  }

  const query = input.produto.tituloMl ?? input.produto.nomeOriginal;
  const params = new URLSearchParams({ q: query, limit: "1" });
  const data = await mlRequest({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: input.accessToken,
    path: `/sites/${ML_SITE_ID}/domain_discovery/search?${params.toString()}`,
  });

  if (Array.isArray(data)) {
    const first = data[0];
    if (isRecord(first) && typeof first.category_id === "string") {
      return first.category_id;
    }
  }

  return null;
}

/** `pictures.upload` (from a source URL) → uploaded picture id, or null. */
export async function uploadMlPicture(input: {
  apiBaseUrl: string;
  accessToken: string;
  imageUrl: string;
}): Promise<string | null> {
  const data = await mlRequest({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: input.accessToken,
    path: "/pictures/items/upload",
    method: "POST",
    body: { source: input.imageUrl },
  });

  if (isRecord(data) && typeof data.id === "string") {
    return data.id;
  }

  return null;
}

/** `items.create` → created item id + optional permalink. */
export async function createMlItem(input: {
  apiBaseUrl: string;
  accessToken: string;
  payload: Record<string, unknown>;
}): Promise<{ id: string; permalink: string | null }> {
  const data = await mlRequest({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: input.accessToken,
    path: "/items",
    method: "POST",
    body: input.payload,
  });

  if (isRecord(data) && typeof data.id === "string") {
    return {
      id: data.id,
      permalink: typeof data.permalink === "string" ? data.permalink : null,
    };
  }

  throw new Error(
    `Mercado Livre não retornou item id: ${JSON.stringify(data)}`,
  );
}

/** Attaches a plain-text description to a freshly created item. */
export async function addMlDescription(input: {
  apiBaseUrl: string;
  accessToken: string;
  itemId: string;
  descricao: string;
}): Promise<void> {
  await mlRequest({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: input.accessToken,
    path: `/items/${input.itemId}/description`,
    method: "POST",
    body: { plain_text: input.descricao },
  });
}

/** `items.pause` / `items.activate` — flips an existing listing's status. */
export async function setMlItemStatus(input: {
  apiBaseUrl: string;
  accessToken: string;
  itemId: string;
  status: "paused" | "active";
}): Promise<void> {
  await mlRequest({
    apiBaseUrl: input.apiBaseUrl,
    accessToken: input.accessToken,
    path: `/items/${input.itemId}`,
    method: "PUT",
    body: { status: input.status },
  });
}

/** Builds the `items.create` payload from a `Produto`. Pure. */
export function buildMlItemPayload(input: {
  produto: Produto;
  categoryId: string;
  pictureIds: string[];
}): Record<string, unknown> {
  const { produto } = input;
  const pictures =
    input.pictureIds.length > 0
      ? input.pictureIds.map((id) => ({ id }))
      : produto.fotoUrl
        ? [{ source: produto.fotoUrl }]
        : [];

  return {
    title: (produto.tituloMl ?? produto.nomeOriginal).slice(0, 60),
    category_id: input.categoryId,
    price: Number(produto.preco),
    currency_id: "BRL",
    available_quantity: produto.quantidade,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_special",
    condition: produto.condicao,
    pictures,
    shipping: { mode: "me2", local_pick_up: false, free_shipping: false },
    attributes: [],
  };
}

/**
 * Resolves a valid ML access token for a Cliente's `ConnectorAccount` — the
 * single source of truth also read by the order sync. Refreshes (and persists
 * back onto the SAME account) via `MercadoLivreClient` when near expiry. Writing
 * back to one store fixes the refresh-token invalidation of the old dual store.
 */
async function resolveMlToken(input: {
  config: MercadoLivreConfig;
  account: ConnectorAccount;
}): Promise<string> {
  const { account } = input;
  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0;
  const stillValid = expiresAt - Date.now() > TOKEN_REFRESH_SKEW_SECONDS * 1000;
  if (stillValid) {
    return connectorAccessTokenFromAccount(account);
  }

  const refreshToken = await connectorRefreshTokenFromAccount(account);
  if (!refreshToken) {
    throw new Error(
      "Conexão Mercado Livre sem refresh token — reconecte a conta.",
    );
  }

  const client = new MercadoLivreClient({ config: input.config });
  const refreshed = await client.refreshAccessToken(refreshToken);

  const credentialFields = await vaultCredentialFields({
    workspaceId: account.workspaceId,
    provider: ConnectorProvider.MERCADO_LIVRE,
    externalAccountId: account.externalAccountId,
    credentials: { accessToken: refreshed.accessToken },
    refreshToken: refreshed.refreshToken ?? refreshToken,
    tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
  });

  await prisma.connectorAccount.update({
    where: { id: account.id },
    data: credentialFields,
  });

  return refreshed.accessToken;
}

type PublishResult = {
  produtoId: string;
  itemId: string;
};

/**
 * Publishes a `Produto` on Mercado Livre for the given Cliente: resolves the
 * token, discovers the category, uploads the picture, creates the item, adds
 * the description, then persists `mlItemId` / `payloadMl` / status and writes a
 * `Publicacao` audit row. Any failure flips the product to `erro`.
 */
export async function publishProdutoToMl(input: {
  clienteId: string;
  produtoId: string;
}): Promise<PublishResult> {
  const config = getMlEnvConfig();
  if (!config) {
    throw new Error("Credenciais Mercado Livre não configuradas no ambiente.");
  }

  const produto = await prisma.produto.findFirst({
    where: { id: input.produtoId, clienteId: input.clienteId },
  });
  if (!produto) {
    throw new Error("Produto não encontrado.");
  }

  const account = await prisma.connectorAccount.findFirst({
    where: {
      clienteId: input.clienteId,
      provider: ConnectorProvider.MERCADO_LIVRE,
      status: ConnectorStatus.ACTIVE,
    },
  });
  if (!account) {
    throw new Error("Conta Mercado Livre não conectada para este cliente.");
  }

  await prisma.produto.update({
    where: { id: produto.id },
    data: { status: "publicando" },
  });

  try {
    const accessToken = await resolveMlToken({ config, account });
    const apiBaseUrl = config.apiBaseUrl;

    const categoryId = await resolveMlCategoryId({
      apiBaseUrl,
      accessToken,
      produto,
    });
    if (!categoryId) {
      throw new Error("Categoria Mercado Livre não encontrada.");
    }

    const pictureIds: string[] = [];
    if (produto.fotoUrl && !produto.fotoUrl.startsWith("/")) {
      const pictureId = await uploadMlPicture({
        apiBaseUrl,
        accessToken,
        imageUrl: produto.fotoUrl,
      });
      if (pictureId) pictureIds.push(pictureId);
    }

    const payload = buildMlItemPayload({ produto, categoryId, pictureIds });
    const item = await createMlItem({ apiBaseUrl, accessToken, payload });

    if (produto.descricao) {
      await addMlDescription({
        apiBaseUrl,
        accessToken,
        itemId: item.id,
        descricao: produto.descricao,
      });
    }

    await prisma.$transaction([
      prisma.produto.update({
        where: { id: produto.id },
        data: {
          mlItemId: item.id,
          payloadMl: payload as Prisma.InputJsonValue,
          status: "publicado",
        },
      }),
      prisma.publicacao.create({
        data: {
          produtoId: produto.id,
          clienteId: input.clienteId,
          plataforma: "MERCADO_LIVRE",
          status: "sucesso",
          respostaApi: { id: item.id, permalink: item.permalink },
        },
      }),
    ]);

    return { produtoId: produto.id, itemId: item.id };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha desconhecida ao publicar no Mercado Livre.";

    await prisma.$transaction([
      prisma.produto.update({
        where: { id: produto.id },
        data: { status: "erro" },
      }),
      prisma.publicacao.create({
        data: {
          produtoId: produto.id,
          clienteId: input.clienteId,
          plataforma: "MERCADO_LIVRE",
          status: "erro",
          erroMensagem: message,
          respostaApi: { error: message },
        },
      }),
    ]);

    throw error;
  }
}
