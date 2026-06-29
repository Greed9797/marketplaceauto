import {
  ConnectorProvider,
  ConnectorStatus,
  SyncStatus,
  type ConnectorAccount,
  type Prisma,
} from "@prisma/client";

import {
  buildConnectorBackfillEvent,
  type ConnectorBackfillEvent,
  type ConnectorSyncType,
} from "@/lib/connectors/backfill";

export type ProductionSyncType = ConnectorSyncType;

type SyncableConnector = Pick<ConnectorAccount, "id" | "provider" | "status">;
type SyncJobConnector = Pick<
  ConnectorAccount,
  "id" | "workspaceId" | "provider"
>;

const adsProviders = new Set<ConnectorProvider>([
  ConnectorProvider.META_ADS,
  ConnectorProvider.GOOGLE_ADS,
]);
const analyticsProviders = new Set<ConnectorProvider>([ConnectorProvider.GA4]);

const ecommerceProviders = new Set<ConnectorProvider>([
  ConnectorProvider.SHOPIFY,
  ConnectorProvider.NUVEMSHOP,
  ConnectorProvider.ISET,
  ConnectorProvider.TRAY,
  ConnectorProvider.WBUY,
  ConnectorProvider.MAGAZORD,
  ConnectorProvider.GOOGLE_SHEETS,
  ConnectorProvider.LOJA_INTEGRADA,
]);

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildIncrementalSyncRange(
  provider: ConnectorProvider,
  now = new Date(),
) {
  const until = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const since = new Date(until);
  since.setUTCDate(
    since.getUTCDate() -
      (adsProviders.has(provider) || analyticsProviders.has(provider) ? 7 : 3),
  );

  return {
    since: dateOnly(since),
    until: dateOnly(until),
  };
}

export function isSyncableProvider(provider: ConnectorProvider) {
  return (
    adsProviders.has(provider) ||
    analyticsProviders.has(provider) ||
    ecommerceProviders.has(provider)
  );
}

export function buildSyncRunEvents(input: {
  connectors: SyncableConnector[];
  now?: Date;
}): ConnectorBackfillEvent[] {
  return input.connectors
    .filter((connector) => connector.status === ConnectorStatus.ACTIVE)
    .filter((connector) => isSyncableProvider(connector.provider))
    .map((connector) =>
      buildConnectorBackfillEvent({
        provider: connector.provider,
        connectorAccountId: connector.id,
        range: buildIncrementalSyncRange(connector.provider, input.now),
        syncType: "INCREMENTAL",
      }),
    );
}

export function buildSyncJobCreateInput(input: {
  connector: SyncJobConnector;
  syncType: ProductionSyncType;
  cursor?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return {
    connectorAccountId: input.connector.id,
    workspaceId: input.connector.workspaceId,
    provider: input.connector.provider,
    syncType: input.syncType,
    cursor: input.cursor ?? null,
    status: SyncStatus.RUNNING,
    metadata: input.metadata ?? undefined,
  };
}
