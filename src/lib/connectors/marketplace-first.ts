import { ConnectorProvider } from "@prisma/client";

/**
 * Marketplace-first mode. When enabled (the default), the paid-traffic
 * connectors (Meta/Google Ads, GA4, Search Console) are hidden from the UI and
 * excluded from the default dashboard traffic aggregation, focusing the product
 * on marketplace commerce. The enum values and underlying arrays stay intact, so
 * the toggle is fully reversible by setting `MARKETPLACE_FIRST=false`.
 */
export const MARKETPLACE_FIRST = process.env.MARKETPLACE_FIRST !== "false";

export const HIDDEN_TRAFFIC_PROVIDERS = [
  ConnectorProvider.META_ADS,
  ConnectorProvider.GOOGLE_ADS,
  ConnectorProvider.GA4,
  ConnectorProvider.SEARCH_CONSOLE,
] as const;

export function isHiddenProvider(provider: ConnectorProvider): boolean {
  if (!MARKETPLACE_FIRST) {
    return false;
  }

  return (HIDDEN_TRAFFIC_PROVIDERS as readonly ConnectorProvider[]).includes(
    provider,
  );
}
