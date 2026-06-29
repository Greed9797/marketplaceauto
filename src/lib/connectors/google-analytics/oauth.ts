export const GOOGLE_ANALYTICS_OAUTH_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type GoogleAnalyticsConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function buildGoogleAnalyticsOAuthUrl(input: {
  state: string;
  config: GoogleAnalyticsConfig;
  scope?: string;
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scope ?? GOOGLE_ANALYTICS_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);

  return url;
}
