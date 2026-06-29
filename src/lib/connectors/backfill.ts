import { ConnectorProvider } from "@prisma/client";

export type ConnectorBackfillRange = {
  since: string;
  until: string;
};

export type ConnectorBackfillEventName =
  | "connector.meta.backfill"
  | "connector.google_ads.backfill"
  | "connector.google_analytics.backfill"
  | "connector.shopify.backfill"
  | "connector.ecommerce.backfill";

export type ConnectorSyncType =
  | "BACKFILL"
  | "INCREMENTAL"
  | "TOKEN_REFRESH"
  | "MANUAL";

export type ConnectorBackfillEvent = {
  name: ConnectorBackfillEventName;
  data: {
    connectorAccountId: string;
    range: ConnectorBackfillRange;
    syncType?: ConnectorSyncType;
  };
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildBackfillRange(
  now = new Date(),
  lookbackDays = 90,
): ConnectorBackfillRange {
  const until = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - lookbackDays);

  return {
    since: dateOnly(since),
    until: dateOnly(until),
  };
}

function hasShopifyReadAllOrders(scopes: string | null | undefined) {
  return (scopes ?? "")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .includes("read_all_orders");
}

export function lookbackDaysForProvider(input: {
  provider: ConnectorProvider;
  scopes?: string | null;
}) {
  if (
    input.provider === ConnectorProvider.SHOPIFY &&
    !hasShopifyReadAllOrders(input.scopes)
  ) {
    return 60;
  }

  return 90;
}

function eventNameForProvider(
  provider: ConnectorProvider,
): ConnectorBackfillEventName {
  switch (provider) {
    case ConnectorProvider.META_ADS:
      return "connector.meta.backfill";
    case ConnectorProvider.GOOGLE_ADS:
      return "connector.google_ads.backfill";
    case ConnectorProvider.GA4:
      return "connector.google_analytics.backfill";
    case ConnectorProvider.SHOPIFY:
      return "connector.shopify.backfill";
    case ConnectorProvider.NUVEMSHOP:
    case ConnectorProvider.MERCADO_LIVRE:
    case ConnectorProvider.SHOPEE:
    case ConnectorProvider.ISET:
    case ConnectorProvider.TRAY:
    case ConnectorProvider.WBUY:
    case ConnectorProvider.MAGAZORD:
    case ConnectorProvider.GOOGLE_SHEETS:
    case ConnectorProvider.LOJA_INTEGRADA:
      return "connector.ecommerce.backfill";
    default:
      throw new Error(`Provider ${provider} does not support MVP backfill`);
  }
}

export function buildConnectorBackfillEvent(input: {
  provider: ConnectorProvider;
  connectorAccountId: string;
  now?: Date;
  scopes?: string | null;
  range?: ConnectorBackfillRange;
  syncType?: ConnectorSyncType;
}): ConnectorBackfillEvent {
  const data: ConnectorBackfillEvent["data"] = {
    connectorAccountId: input.connectorAccountId,
    range:
      input.range ??
      buildBackfillRange(
        input.now,
        lookbackDaysForProvider({
          provider: input.provider,
          scopes: input.scopes,
        }),
      ),
  };

  if (input.syncType) {
    data.syncType = input.syncType;
  }

  return {
    name: eventNameForProvider(input.provider),
    data,
  };
}
