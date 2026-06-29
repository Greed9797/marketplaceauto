import { syncGoogleAdsDailyMetrics, type GoogleAdsSyncRange } from "@/lib/connectors/google-ads/sync";
import type { ConnectorSyncType } from "@/lib/connectors/backfill";
import { inngest } from "@/lib/jobs/inngest-client";

type SyncGoogleAdsBackfillEvent = {
  connectorAccountId: string;
  range: GoogleAdsSyncRange;
  syncType?: ConnectorSyncType;
};

export const syncGoogleAdsBackfill = inngest.createFunction(
  {
    id: "connector-google-ads-backfill",
    retries: 5,
    triggers: [{ event: "connector.google_ads.backfill" }],
  },
  async ({ event, step }) => {
    const data = event.data as SyncGoogleAdsBackfillEvent;

    return step.run("sync google ads daily metrics", () =>
      syncGoogleAdsDailyMetrics({
        connectorAccountId: data.connectorAccountId,
        range: data.range,
        syncType: data.syncType,
      }),
    );
  },
);
