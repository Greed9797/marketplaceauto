import { syncShopifyOrders, type ShopifySyncRange } from "@/lib/connectors/shopify/sync";
import type { ConnectorSyncType } from "@/lib/connectors/backfill";
import { inngest } from "@/lib/jobs/inngest-client";

type SyncShopifyBackfillEvent = {
  connectorAccountId: string;
  range: ShopifySyncRange;
  syncType?: ConnectorSyncType;
};

export const syncShopifyBackfill = inngest.createFunction(
  {
    id: "connector-shopify-backfill",
    retries: 5,
    triggers: [{ event: "connector.shopify.backfill" }],
  },
  async ({ event, step }) => {
    const data = event.data as SyncShopifyBackfillEvent;

    return step.run("sync shopify orders", () =>
      syncShopifyOrders({
        connectorAccountId: data.connectorAccountId,
        range: data.range,
        syncType: data.syncType,
      }),
    );
  },
);
