export const META_DEFAULT_API_VERSION = "v25.0";
export const META_OAUTH_SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
  "read_insights",
] as const;

export type MetaConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiVersion: string;
};

export function buildMetaOAuthUrl(
  input: { state: string; config: MetaConfig; scopes?: readonly string[] },
) {
  const url = new URL(`https://www.facebook.com/${input.config.apiVersion}/dialog/oauth`);

  url.searchParams.set("client_id", input.config.appId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", (input.scopes ?? META_OAUTH_SCOPES).join(","));
  url.searchParams.set("response_type", "code");

  return url;
}
