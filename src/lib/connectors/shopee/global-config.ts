import { SHOPEE_DEFAULT_HOST, type ShopeeConfig } from "./oauth";

/**
 * Shared Shopee OAuth config sourced from env vars — the optional "official W3
 * app" so a workspace doesn't have to provision its own Shopee partner app.
 *
 * Per-workspace ConnectorProviderConfig still takes precedence; this is the
 * fallback when no DB row is configured for SHOPEE. Returns null when the
 * partner credentials are absent or the partner id isn't a valid number.
 */
export function getGlobalShopeeConfig(
  redirectUriOrigin: string,
): ShopeeConfig | null {
  const partnerIdRaw = process.env.SHOPEE_PARTNER_ID?.trim();
  const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim();

  if (!partnerIdRaw || !partnerKey) {
    return null;
  }

  const partnerId = Number(partnerIdRaw);
  if (!Number.isFinite(partnerId) || partnerId <= 0) {
    return null;
  }

  const host = process.env.SHOPEE_HOST?.trim() || SHOPEE_DEFAULT_HOST;
  const explicitRedirect = process.env.SHOPEE_REDIRECT_URI?.trim();
  const redirectUri =
    explicitRedirect ||
    `${redirectUriOrigin.replace(/\/$/, "")}/api/connectors/shopee/callback`;

  return {
    partnerId,
    partnerKey,
    redirectUri,
    host,
  };
}
