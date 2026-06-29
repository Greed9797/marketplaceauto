import { signPublicRequest, SHOPEE_HOST } from "./signer";

export const SHOPEE_OAUTH_STATE_COOKIE = "adstart_shopee_oauth_state";
export const SHOPEE_DEFAULT_HOST = SHOPEE_HOST;
export const SHOPEE_AUTH_PARTNER_PATH = "/api/v2/shop/auth_partner";

export type ShopeeConfig = {
  partnerId: number;
  partnerKey: string;
  redirectUri: string;
  host: string;
};

/**
 * Builds the Shopee authorization URL.
 *
 * Unlike a standard OAuth provider, Shopee echoes back ONLY `code` and
 * `shop_id` to the redirect URL — it does not preserve a `state` query param of
 * its own. So our signed CSRF state is appended to the `redirect` value itself;
 * Shopee returns the redirect verbatim and tacks `code`/`shop_id` on, letting
 * the callback recover the signed state.
 *
 * The `timestamp` placed in the query MUST match the one signed into the base
 * string (public scheme), so both derive from the same `now`.
 */
export function buildShopeeOAuthUrl(input: {
  state: string;
  config: ShopeeConfig;
  now?: number;
}) {
  const timestamp = Math.floor((input.now ?? Date.now()) / 1000);
  const sign = signPublicRequest({
    partnerId: input.config.partnerId,
    partnerKey: input.config.partnerKey,
    apiPath: SHOPEE_AUTH_PARTNER_PATH,
    timestamp,
  });

  const redirect = new URL(input.config.redirectUri);
  redirect.searchParams.set("state", input.state);

  const url = new URL(`${input.config.host}${SHOPEE_AUTH_PARTNER_PATH}`);
  url.searchParams.set("partner_id", String(input.config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("redirect", redirect.toString());

  return url;
}
