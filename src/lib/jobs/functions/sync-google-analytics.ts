import { inngest } from "@/lib/jobs/inngest-client";
import type { ConnectorSyncType } from "@/lib/connectors/backfill";
import { syncGoogleAnalyticsSessions } from "@/lib/connectors/google-analytics/sync";

type SyncGoogleAnalyticsBackfillEvent = {
  connectorAccountId: string;
  range: { since: string; until: string };
  syncType?: ConnectorSyncType;
};

export const syncGoogleAnalyticsBackfill = inngest.createFunction(
  {
    id: "connector-google-analytics-backfill",
    retries: 5,
    triggers: [{ event: "connector.google_analytics.backfill" }],
  },
  async ({ event, step }) => {
    const data = event.data as SyncGoogleAnalyticsBackfillEvent;

    return step.run("sync google analytics sessions", () =>
      syncGoogleAnalyticsSessions({
        connectorAccountId: data.connectorAccountId,
        range: data.range,
        syncType: data.syncType,
      }),
    );
  },
);
