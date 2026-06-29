export const NUVEMSHOP_OAUTH_STATE_COOKIE = "adstart_nuvemshop_oauth_state";
export const NUVEMSHOP_DEFAULT_API_BASE_URL = "https://api.nuvemshop.com.br/v1";

export type NuvemshopConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
};

export function buildNuvemshopOAuthUrl(input: {
  state: string;
  config: NuvemshopConfig;
}) {
  const url = new URL(
    `https://www.nuvemshop.com.br/apps/${input.config.clientId}/authorize`,
  );

  url.searchParams.set("state", input.state);

  return url;
}
