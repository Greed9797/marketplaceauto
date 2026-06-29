import { createHmac } from "node:crypto";

/**
 * Shopee Open Platform v2 request signing.
 *
 * Every Shopee request carries an HMAC-SHA256 signature (lowercase hex) of
 * `partner_key` over a base string. There are TWO base-string schemes:
 *
 *  - PUBLIC endpoints (shop/auth_partner, auth/token/get, auth/access_token/get):
 *      baseString = partner_id + api_path + timestamp
 *  - SHOP endpoints (order/get_order_list, order/get_order_detail, ...):
 *      baseString = partner_id + api_path + timestamp + access_token + shop_id
 *
 * `timestamp` is UNIX time in SECONDS and MUST equal the value placed in the
 * request query. Clock skew between this host and Shopee's servers invalidates
 * the signature ("error_sign"), so the system clock has to stay in sync.
 */

export const SHOPEE_HOST = "https://partner.shopeemobile.com";
export const SHOPEE_SANDBOX_HOST =
  "https://partner.test-stable.shopeemobile.com";

export function shopeeHmacHex(partnerKey: string, baseString: string): string {
  return createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

export function buildPublicBaseString(input: {
  partnerId: number;
  apiPath: string;
  timestamp: number;
}): string {
  return `${input.partnerId}${input.apiPath}${input.timestamp}`;
}

export function buildShopBaseString(input: {
  partnerId: number;
  apiPath: string;
  timestamp: number;
  accessToken: string;
  shopId: number;
}): string {
  return `${input.partnerId}${input.apiPath}${input.timestamp}${input.accessToken}${input.shopId}`;
}

/** Signature for public endpoints (auth, token get/refresh). */
export function signPublicRequest(input: {
  partnerId: number;
  partnerKey: string;
  apiPath: string;
  timestamp: number;
}): string {
  return shopeeHmacHex(input.partnerKey, buildPublicBaseString(input));
}

/** Signature for shop-scoped endpoints (order list/detail). */
export function signShopRequest(input: {
  partnerId: number;
  partnerKey: string;
  apiPath: string;
  timestamp: number;
  accessToken: string;
  shopId: number;
}): string {
  return shopeeHmacHex(input.partnerKey, buildShopBaseString(input));
}
