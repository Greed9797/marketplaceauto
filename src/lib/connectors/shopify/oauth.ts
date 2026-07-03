import { createHmac, timingSafeEqual } from "node:crypto";

export const SHOPIFY_DEFAULT_API_VERSION = "2026-04";
export const SHOPIFY_DEFAULT_SCOPES =
  "read_orders,read_all_orders,read_products,read_customers,read_analytics";

export type ShopifyConfig = {
  apiVersion: string;
  apiKey: string;
  apiSecret: string;
  redirectUri: string;
  scopes: string;
};

export function normalizeShopDomain(value: string) {
  const withoutProtocol = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\/$/, "");
  const shop = withoutProtocol.endsWith(".myshopify.com")
    ? withoutProtocol
    : `${withoutProtocol}.myshopify.com`;

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error("Invalid Shopify shop domain");
  }

  return shop;
}

export function buildShopifyOAuthUrl(input: {
  shop: string;
  state: string;
  config: ShopifyConfig;
}) {
  const shop = normalizeShopDomain(input.shop);
  const url = new URL(`https://${shop}/admin/oauth/authorize`);

  url.searchParams.set("client_id", input.config.apiKey);
  url.searchParams.set("scope", input.config.scopes);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("state", input.state);

  return url;
}

function shopifyHmacMessage(params: URLSearchParams) {
  return Array.from(params.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function verifyShopifyQueryHmac(
  params: URLSearchParams,
  secret: string,
) {
  const hmac = params.get("hmac");
  if (!hmac) {
    return false;
  }

  const digest = createHmac("sha256", secret)
    .update(shopifyHmacMessage(params))
    .digest("hex");
  const received = Buffer.from(hmac, "hex");
  const expected = Buffer.from(digest, "hex");

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}

export function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
) {
  if (!hmacHeader) {
    return false;
  }

  const digest = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  const received = Buffer.from(hmacHeader, "base64");
  const expected = Buffer.from(digest, "base64");

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}
