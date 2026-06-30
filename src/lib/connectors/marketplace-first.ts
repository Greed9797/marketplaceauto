import { ConnectorProvider } from "@prisma/client";

/**
 * Marketplace-first mode (default on). This internal build surfaces ONLY the
 * Shopee and Mercado Livre marketplace connectors and their sales data.
 * Everything else — paid traffic (Meta/Google Ads, GA4, Search Console) AND the
 * other commerce platforms (Shopify, Nuvemshop, WBuy, iSet, Tray, Magazord,
 * Google Sheets, Loja Integrada) — is hidden from the UI and excluded from
 * dashboard aggregation. The enum values and underlying arrays stay intact, so
 * the toggle is fully reversible by setting `MARKETPLACE_FIRST=false`.
 */
export const MARKETPLACE_FIRST = process.env.MARKETPLACE_FIRST !== "false";

/** The only providers surfaced while MARKETPLACE_FIRST is on. */
export const MARKETPLACE_PROVIDERS = [
  ConnectorProvider.SHOPEE,
  ConnectorProvider.MERCADO_LIVRE,
] as const;

export function isMarketplaceProvider(provider: ConnectorProvider): boolean {
  return (MARKETPLACE_PROVIDERS as readonly ConnectorProvider[]).includes(
    provider,
  );
}

/**
 * A provider is hidden when marketplace-first is on and it is not one of the
 * allowed marketplace providers (Shopee / Mercado Livre).
 */
export function isHiddenProvider(provider: ConnectorProvider): boolean {
  if (!MARKETPLACE_FIRST) {
    return false;
  }

  return !isMarketplaceProvider(provider);
}
