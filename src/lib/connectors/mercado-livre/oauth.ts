export const MERCADO_LIVRE_OAUTH_STATE_COOKIE =
  "adstart_mercado_livre_oauth_state";
export const MERCADO_LIVRE_DEFAULT_API_BASE_URL =
  "https://api.mercadolibre.com";
export const MERCADO_LIVRE_AUTH_BASE_URL = "https://auth.mercadolivre.com.br";

export type MercadoLivreConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
};

export function buildMercadoLivreOAuthUrl(input: {
  state: string;
  config: MercadoLivreConfig;
}) {
  const url = new URL(`${MERCADO_LIVRE_AUTH_BASE_URL}/authorization`);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("state", input.state);
  // offline_access garante o refresh_token (sem ele o token expira em ~6h e o
  // sync diário para); read basta para ler pedidos (não escrevemos no ML).
  url.searchParams.set("scope", "offline_access read");

  return url;
}
