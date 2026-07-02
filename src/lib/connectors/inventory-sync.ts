import { ConnectorProvider, ConnectorStatus } from "@prisma/client";

import { connectorCredentialsFromAccountVaultAware } from "@/lib/connectors/credentials";
import type { InventoryRow } from "@/lib/connectors/inventory";
import { ManualCommerceClient } from "@/lib/connectors/manual-commerce-client";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { NuvemshopClient } from "@/lib/connectors/nuvemshop/client";
import {
  buildNuvemshopConfigFromProviderConfig,
  buildShopeeConfigFromProviderConfig,
  buildShopifyConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { ShopeeClient } from "@/lib/connectors/shopee/client";
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import { ShopifyClient } from "@/lib/connectors/shopify/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Providers whose product catalog (stock + category) the inventory sync can
 * pull. Manual providers (Loja Integrada, WBuy, Magazord, Tray) route through
 * ManualCommerceClient.listInventory(); Nuvemshop/Shopify through their OAuth
 * clients' listProducts(). iSET is intentionally excluded — its order API does
 * not return line items, so there are no dashboard product rows to enrich.
 */
const INVENTORY_PROVIDERS = new Set<ConnectorProvider>([
  ConnectorProvider.LOJA_INTEGRADA,
  ConnectorProvider.NUVEMSHOP,
  ConnectorProvider.SHOPIFY,
  ConnectorProvider.WBUY,
  ConnectorProvider.MAGAZORD,
  ConnectorProvider.TRAY,
  ConnectorProvider.MERCADO_LIVRE,
  ConnectorProvider.SHOPEE,
]);

export function supportsInventory(provider: ConnectorProvider): boolean {
  return INVENTORY_PROVIDERS.has(provider);
}

// The catalog fetch is heavy (full product list, paginated) and stock changes
// slowly, so re-pull at most this often even when order syncs fire faster
// (e.g. real-time mode every ~5min).
const INVENTORY_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Pulls the current per-product stock for one connector and upserts it into
 * ProductInventory (keyed by connectorAccountId + externalProductId, so a
 * re-sync overwrites quantities in place). No-op for providers without an
 * inventory source. Returns how many products were written.
 */
export async function syncConnectorInventory(input: {
  connectorAccountId: string;
}): Promise<{ count: number }> {
  const connector = await prisma.connectorAccount.findUnique({
    where: { id: input.connectorAccountId },
    select: {
      id: true,
      workspaceId: true,
      provider: true,
      status: true,
      externalAccountId: true,
      credentialSecretId: true,
      accessTokenCiphertext: true,
      tokenIv: true,
      tokenAuthTag: true,
      tokenKeyVersion: true,
    },
  });

  if (
    !connector ||
    connector.status !== ConnectorStatus.ACTIVE ||
    !supportsInventory(connector.provider)
  ) {
    return { count: 0 };
  }

  // Cooldown: skip if this connector's inventory was refreshed recently.
  const recent = await prisma.productInventory.findFirst({
    where: { connectorAccountId: connector.id },
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });
  if (
    recent &&
    Date.now() - recent.syncedAt.getTime() < INVENTORY_COOLDOWN_MS
  ) {
    return { count: 0 };
  }

  const credentials =
    await connectorCredentialsFromAccountVaultAware(connector);
  const accessToken =
    typeof credentials.accessToken === "string"
      ? credentials.accessToken
      : null;

  let rows: InventoryRow[];

  if (connector.provider === ConnectorProvider.NUVEMSHOP) {
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.NUVEMSHOP,
    });
    if (!providerConfig || !accessToken) {
      return { count: 0 };
    }
    const client = new NuvemshopClient({
      config: await buildNuvemshopConfigFromProviderConfig(providerConfig),
    });
    rows = await client.listProducts({
      storeId: connector.externalAccountId,
      accessToken,
    });
  } else if (connector.provider === ConnectorProvider.SHOPIFY) {
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPIFY,
    });
    if (!providerConfig || !accessToken) {
      return { count: 0 };
    }
    const client = new ShopifyClient({
      config: await buildShopifyConfigFromProviderConfig(providerConfig),
    });
    rows = await client.listProducts({
      shop: connector.externalAccountId,
      accessToken,
    });
  } else if (connector.provider === ConnectorProvider.MERCADO_LIVRE) {
    if (!accessToken || !connector.externalAccountId) {
      return { count: 0 };
    }
    // Listagem/estoque só precisam do token do seller (available_quantity real
    // exige o token do próprio seller — sem token viria por faixas).
    const client = new MercadoLivreClient({});
    rows = await client.listInventory({
      sellerId: connector.externalAccountId,
      accessToken,
    });
  } else if (connector.provider === ConnectorProvider.SHOPEE) {
    const shopId = Number(connector.externalAccountId);
    if (!accessToken || !Number.isFinite(shopId) || shopId <= 0) {
      return { count: 0 };
    }
    // Toda chamada shop-level é assinada com as credenciais do partner app —
    // ProviderConfig do workspace primeiro, env "app W3" como fallback.
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPEE,
    });
    const config = providerConfig
      ? await buildShopeeConfigFromProviderConfig(providerConfig)
      : getGlobalShopeeConfig(process.env.NEXTAUTH_URL?.trim() ?? "");
    if (!config) {
      return { count: 0 };
    }
    const client = new ShopeeClient({ config });
    rows = await client.listInventory({ shopId, accessToken });
  } else {
    // Manual providers (Loja Integrada, WBuy, Magazord, Tray).
    const client = new ManualCommerceClient({
      provider: connector.provider,
      credentials,
    });
    rows = await client.listInventory();
  }

  const syncedAt = new Date();

  for (const row of rows) {
    await prisma.productInventory.upsert({
      where: {
        connectorAccountId_externalProductId: {
          connectorAccountId: connector.id,
          externalProductId: row.externalProductId,
        },
      },
      update: {
        sku: row.sku,
        productName: row.productName,
        categoryName: row.categoryName,
        quantity: row.quantity,
        syncedAt,
      },
      create: {
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        externalProductId: row.externalProductId,
        sku: row.sku,
        productName: row.productName,
        categoryName: row.categoryName,
        quantity: row.quantity,
      },
    });
  }

  return { count: rows.length };
}
