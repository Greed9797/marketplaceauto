import {
  MERCADO_LIVRE_DEFAULT_API_BASE_URL,
  type MercadoLivreConfig,
} from "@/lib/connectors/mercado-livre/oauth";

/**
 * Builds a Mercado Livre OAuth config from the "auto" publisher environment
 * variables (ML_APP_ID, ML_SECRET, ML_REDIRECT_URI). Returns null when a
 * required variable is missing so the calling route can redirect with a
 * friendly error instead of throwing.
 */
export function getMlEnvConfig(): MercadoLivreConfig | null {
  const clientId = process.env.ML_APP_ID;
  const clientSecret = process.env.ML_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBaseUrl: MERCADO_LIVRE_DEFAULT_API_BASE_URL,
  };
}
