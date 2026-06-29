import { ConnectorStatus } from "@prisma/client";
import { cron } from "inngest";

import { prisma } from "@/lib/db/prisma";
import { buildSyncRunEvents, isSyncableProvider } from "@/lib/jobs/sync-operations";
import { inngest } from "@/lib/jobs/inngest-client";

export const syncActiveConnectorsDaily = inngest.createFunction(
  {
    id: "connector-daily-incremental-sync",
    retries: 2,
    triggers: [cron("TZ=UTC 0 9 * * *")],
  },
  async ({ step }) => {
    const connectors = await step.run("load active connectors", () =>
      prisma.connectorAccount.findMany({
        where: {
          status: ConnectorStatus.ACTIVE,
        },
        select: {
          id: true,
          provider: true,
          status: true,
        },
      }),
    );
    const events = buildSyncRunEvents({
      connectors: connectors.filter((connector) => isSyncableProvider(connector.provider)),
    });

    if (events.length === 0) {
      return { queued: 0 };
    }

    await step.sendEvent("queue incremental connector syncs", events);

    return { queued: events.length };
  },
);
