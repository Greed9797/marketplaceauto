import type { MercadoLivreConfig } from "./oauth";
import { MERCADO_LIVRE_DEFAULT_API_BASE_URL } from "./oauth";

/**
 * Returns a shared Mercado Livre OAuth config sourced from env vars. This is the
 * optional "official W3 app" — all workspaces share a single App ID + secret so
 * users don't need to provision their own Mercado Livre application.
 *
 * Per-workspace ConnectorProviderConfig still takes precedence; this is the
 * fallback when no DB row is configured for MERCADO_LIVRE. Returns null when the
 * env credentials are absent.
 */
export function getGlobalMercadoLivreConfig(
  redirectUriOrigin: string,
): MercadoLivreConfig | null {
  const clientId = process.env.ML_CLIENT_ID?.trim();
  const clientSecret = process.env.ML_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  const apiBaseUrl =
    process.env.ML_API_BASE_URL?.trim() || MERCADO_LIVRE_DEFAULT_API_BASE_URL;

  // ML_REDIRECT_URI is shared with the publisher OAuth flow (a DIFFERENT ML app
  // whose callback is /api/auth/ml/callback). When it points at the publisher,
  // using it here would send this app's authorize to a redirect that isn't
  // registered for it. ML_CONNECTOR_REDIRECT_URI takes precedence; the shared
  // var only applies when it targets the connector callback.
  const sharedRedirect = process.env.ML_REDIRECT_URI?.trim();
  const explicitRedirect =
    process.env.ML_CONNECTOR_REDIRECT_URI?.trim() ||
    (sharedRedirect && !sharedRedirect.includes("/api/auth/ml/")
      ? sharedRedirect
      : undefined);
  const redirectUri =
    explicitRedirect ||
    `${redirectUriOrigin.replace(/\/$/, "")}/api/connectors/mercado-livre/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBaseUrl,
  };
}
