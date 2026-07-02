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
  // SHOPEE_REDIRECT_URI is shared with the publisher OAuth flow (callback
  // /api/auth/shopee/callback). When it points there, using it here would send
  // the connector authorize to a redirect not registered for this flow.
  // SHOPEE_CONNECTOR_REDIRECT_URI takes precedence; the shared var only applies
  // when it targets the connector callback.
  const sharedRedirect = process.env.SHOPEE_REDIRECT_URI?.trim();
  const explicitRedirect =
    process.env.SHOPEE_CONNECTOR_REDIRECT_URI?.trim() ||
    (sharedRedirect && !sharedRedirect.includes("/api/auth/shopee/")
      ? sharedRedirect
      : undefined);
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
