import { ConnectorProvider } from "@prisma/client";

import {
  syncEcommerceOrders,
  type EcommerceSyncRange,
} from "@/lib/connectors/ecommerce-sync";
import type { ConnectorSyncType } from "@/lib/connectors/backfill";
import { syncMercadoLivreAdsDailyMetrics } from "@/lib/connectors/mercado-livre-ads/sync";
import { syncShopeeAdsDailyMetrics } from "@/lib/connectors/shopee-ads/sync";
import { prisma } from "@/lib/db/prisma";
import { inngest } from "@/lib/jobs/inngest-client";

type SyncEcommerceBackfillEvent = {
  connectorAccountId: string;
  range: EcommerceSyncRange;
  syncType?: ConnectorSyncType;
};

/**
 * Marketplace-native ad spend (Shopee Ads / Mercado Livre Product Ads) is NOT a
 * separately connected source — there is no ConnectorAccount and no OAuth flow
 * for it (see ADR / registry `oauthAdsProviders`). It PIGGYBACKS on its parent
 * marketplace account: the spend report reuses the parent's access token and is
 * written as `DailyMetric` rows under the parent `connectorAccountId` with
 * `source = SHOPEE_ADS` / `MERCADO_LIVRE_ADS`. Because of this, no dedicated
 * Inngest event/function exists (and SHOPEE_ADS/MERCADO_LIVRE_ADS are
 * intentionally absent from `eventNameForProvider`) — the ads pull runs here,
 * inside the parent's `connector.ecommerce.backfill`, AFTER the order sync so
 * the parent token has already been refreshed/re-vaulted.
 *
 * It is isolated: any failure is swallowed + logged, never failing (or
 * retrying, via Inngest) the order sync that already committed.
 */
async function syncMarketplaceAdsForConnector(input: {
  connectorAccountId: string;
  range: EcommerceSyncRange;
}): Promise<{ provider: ConnectorProvider | null; rowsUpserted: number }> {
  const account = await prisma.connectorAccount.findUnique({
    where: { id: input.connectorAccountId },
  });
  if (!account) {
    return { provider: null, rowsUpserted: 0 };
  }

  if (account.provider === ConnectorProvider.SHOPEE) {
    const { rowsUpserted } = await syncShopeeAdsDailyMetrics({
      account,
      range: input.range,
    });
    return { provider: ConnectorProvider.SHOPEE_ADS, rowsUpserted };
  }

  if (account.provider === ConnectorProvider.MERCADO_LIVRE) {
    const { rowsUpserted } = await syncMercadoLivreAdsDailyMetrics({
      account,
      range: input.range,
    });
    return { provider: ConnectorProvider.MERCADO_LIVRE_ADS, rowsUpserted };
  }

  return { provider: null, rowsUpserted: 0 };
}

export const syncEcommerceBackfill = inngest.createFunction(
  {
    id: "connector-ecommerce-backfill",
    retries: 5,
    triggers: [{ event: "connector.ecommerce.backfill" }],
  },
  async ({ event, step }) => {
    const data = event.data as SyncEcommerceBackfillEvent;

    const result = await step.run("sync ecommerce orders", () =>
      syncEcommerceOrders({
        connectorAccountId: data.connectorAccountId,
        range: data.range,
        syncType: data.syncType,
      }),
    );

    // Best-effort marketplace ad-spend piggyback. The try/catch lives INSIDE the
    // step so a failure resolves the step successfully (no Inngest retry of the
    // already-committed order sync) while still surfacing the error in logs.
    await step.run("sync marketplace ads", async () => {
      try {
        return await syncMarketplaceAdsForConnector({
          connectorAccountId: data.connectorAccountId,
          range: data.range,
        });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Unknown ads sync error";
        console.error(
          `[marketplace-ads] sync failed for connector ${data.connectorAccountId}: ${message}`,
        );
        return { skipped: true as const, error: message };
      }
    });

    return result;
  },
);
