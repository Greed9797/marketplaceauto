export const GOOGLE_ADS_DEFAULT_API_VERSION = "v24";
export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";

export type GoogleAdsConfig = {
  apiVersion: string;
  clientId: string;
  clientSecret: string;
  developerToken: string;
  redirectUri: string;
  loginCustomerId?: string;
};

export function buildGoogleAdsOAuthUrl(
  input: { state: string; config: GoogleAdsConfig; scope?: string },
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scope ?? GOOGLE_ADS_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);

  return url;
}
