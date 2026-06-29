import type { NuvemshopConfig } from "./oauth";
import { NUVEMSHOP_DEFAULT_API_BASE_URL } from "./oauth";

/**
 * Returns a shared NUVEMSHOP OAuth config sourced from env vars. This is the
 * "official W3 Ads app" — all workspaces share a single App ID + secret so
 * users don't need to provision their own Nuvemshop Partners app.
 *
 * Per-workspace ConnectorProviderConfig still takes precedence; this is the
 * fallback when no DB row is configured for NUVEMSHOP.
 */
export function getGlobalNuvemshopConfig(
  redirectUriOrigin: string,
): NuvemshopConfig | null {
  const clientId = process.env.NUVEMSHOP_CLIENT_ID?.trim();
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  const apiBaseUrl =
    process.env.NUVEMSHOP_API_BASE_URL?.trim() ||
    NUVEMSHOP_DEFAULT_API_BASE_URL;

  const explicitRedirect = process.env.NUVEMSHOP_REDIRECT_URI?.trim();
  const redirectUri =
    explicitRedirect ||
    `${redirectUriOrigin.replace(/\/$/, "")}/api/connectors/nuvemshop/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBaseUrl,
  };
}

/**
 * Returns just the client secret (synchronously). Used by the LGPD webhook
 * HMAC verifier which doesn't need the full OAuth config.
 */
export function getGlobalNuvemshopClientSecret(): string | null {
  return process.env.NUVEMSHOP_CLIENT_SECRET?.trim() || null;
}
