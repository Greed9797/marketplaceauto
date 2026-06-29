import { ConnectorProvider, ConnectorStatus, SyncStatus } from "@prisma/client";

import { connectorAccessTokenFromAccount } from "@/lib/connectors/credentials";
import {
  ecommerceDailyDedupeHash,
  mapEcommerceOrdersToDailyMetricSummaries,
} from "@/lib/connectors/ecommerce-sync";
import {
  buildShopifyConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { prisma } from "@/lib/db/prisma";
import {
  buildSyncJobCreateInput,
  type ProductionSyncType,
} from "@/lib/jobs/sync-operations";

import { ShopifyClient, type ShopifyOrder } from "./client";

export type ShopifySyncRange = {
  since: string;
  until: string;
};

/**
 * @deprecated Kept as a thin wrapper around `ecommerceDailyDedupeHash` so the
 * webhook route and legacy callers stay compatible while the codebase
 * converges on the canonical helper.
 */
export function dailyDedupeHash(input: {
  workspaceId: string;
  connectorAccountId: string;
  date: string;
}) {
  return ecommerceDailyDedupeHash({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    provider: ConnectorProvider.SHOPIFY,
    date: input.date,
  });
}

export function mapShopifyOrdersToDailyMetricSummaries(input: {
  workspaceId: string;
  connectorAccountId: string;
  orders: ShopifyOrder[];
}) {
  return mapEcommerceOrdersToDailyMetricSummaries({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    provider: ConnectorProvider.SHOPIFY,
    orders: input.orders,
  });
}

export function mapShopifyOrderToEcommerceOrder(input: {
  workspaceId: string;
  connectorAccountId: string;
  order: ShopifyOrder;
}) {
  return {
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    externalOrderId: input.order.externalOrderId,
    platform: ConnectorProvider.SHOPIFY,
    orderNumber: input.order.orderNumber,
    customerEmail: input.order.customerEmail,
    orderTotal: input.order.orderTotal,
    orderCurrency: input.order.orderCurrency,
    itemsCount: input.order.itemsCount,
    status: input.order.status,
    shippingState: input.order.shippingState,
    utmSource: input.order.utmSource,
    utmMedium: input.order.utmMedium,
    utmCampaign: input.order.utmCampaign,
    placedAt: new Date(input.order.placedAt),
  };
}

function mapShopifyOrderItemsToRecords(input: {
  workspaceId: string;
  connectorAccountId: string;
  ecommerceOrderId: string;
  order: ShopifyOrder;
}) {
  return (input.order.items ?? []).map((item) => ({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    ecommerceOrderId: input.ecommerceOrderId,
    externalOrderId: input.order.externalOrderId,
    productName: item.productName,
    sku: item.sku,
    quantity: item.quantity,
    total: item.total,
    placedAt: new Date(input.order.placedAt),
  }));
}

export async function syncShopifyOrders(input: {
  connectorAccountId: string;
  range: ShopifySyncRange;
  syncType?: ProductionSyncType;
}) {
  const connector = await prisma.connectorAccount.findUniqueOrThrow({
    where: { id: input.connectorAccountId },
  });
  const syncJob = await prisma.syncJob.create({
    data: buildSyncJobCreateInput({
      connector,
      syncType: input.syncType ?? "BACKFILL",
      metadata: input.range,
    }),
  });

  try {
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPIFY,
    });
    if (!providerConfig) {
      throw new Error("Shopify provider config is missing");
    }
    const accessToken = await connectorAccessTokenFromAccount(connector);
    const client = new ShopifyClient({
      config: await buildShopifyConfigFromProviderConfig(providerConfig),
    });
    const orders = await client.listOrders({
      shop: connector.externalAccountId,
      accessToken,
      since: input.range.since,
      until: input.range.until,
    });

    for (const order of orders) {
      const payload = mapShopifyOrderToEcommerceOrder({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        order,
      });

      const savedOrder = await prisma.ecommerceOrder.upsert({
        where: {
          connectorAccountId_externalOrderId: {
            connectorAccountId: connector.id,
            externalOrderId: order.externalOrderId,
          },
        },
        update: payload,
        create: payload,
      });
      const itemPayloads = mapShopifyOrderItemsToRecords({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        ecommerceOrderId: savedOrder.id,
        order,
      });

      await prisma.ecommerceOrderItem.deleteMany({
        where: {
          connectorAccountId: connector.id,
          externalOrderId: order.externalOrderId,
        },
      });

      if (itemPayloads.length) {
        await prisma.ecommerceOrderItem.createMany({
          data: itemPayloads,
        });
      }
    }

    const summaries = mapShopifyOrdersToDailyMetricSummaries({
      workspaceId: connector.workspaceId,
      connectorAccountId: connector.id,
      orders,
    });
    for (const summary of summaries) {
      await prisma.dailyMetric.upsert({
        where: { dedupeHash: summary.dedupeHash },
        update: {
          revenue: summary.revenue,
          orders: summary.orders,
        },
        create: {
          workspaceId: connector.workspaceId,
          connectorAccountId: connector.id,
          date: summary.date,
          source: ConnectorProvider.SHOPIFY,
          revenue: summary.revenue,
          orders: summary.orders,
          dedupeHash: summary.dedupeHash,
        },
      });
    }

    await prisma.connectorAccount.update({
      where: { id: connector.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: ConnectorStatus.ACTIVE,
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        rowsUpdated: orders.length,
      },
    });

    return { rowsUpserted: orders.length };
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unknown Shopify sync error";

    await prisma.connectorAccount.update({
      where: { id: input.connectorAccountId },
      data: {
        status: ConnectorStatus.ERROR,
        lastSyncError: message,
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    throw caught;
  }
}
