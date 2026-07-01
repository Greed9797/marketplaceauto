import type { ShopeeConfig } from "@/lib/connectors/shopee/oauth";

/** Production Shopee Open Platform host (used when SHOPEE_SANDBOX !== "true"). */
const SHOPEE_DEFAULT_HOST = "https://partner.shopeemobile.com";
/** Sandbox host, mirrored from the "auto" publisher env contract. */
const SHOPEE_DEFAULT_SANDBOX_HOST =
  "https://partner.test-stable.shopeemobile.com";

/**
 * Builds a Shopee OAuth config from the "auto" publisher environment variables
 * (SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_REDIRECT_URI, SHOPEE_HOST,
 * SHOPEE_SANDBOX_HOST, SHOPEE_SANDBOX). Returns null when a required variable is
 * missing so the calling route can redirect with a friendly error instead of
 * throwing.
 */
export function getShopeeEnvConfig(): ShopeeConfig | null {
  const partnerIdRaw = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  const redirectUri = process.env.SHOPEE_REDIRECT_URI;

  if (!partnerIdRaw || !partnerKey || !redirectUri) {
    return null;
  }

  const partnerId = Number(partnerIdRaw);
  if (!Number.isFinite(partnerId) || partnerId <= 0) {
    return null;
  }

  const isSandbox = process.env.SHOPEE_SANDBOX === "true";
  const host = isSandbox
    ? (process.env.SHOPEE_SANDBOX_HOST ?? SHOPEE_DEFAULT_SANDBOX_HOST)
    : (process.env.SHOPEE_HOST ?? SHOPEE_DEFAULT_HOST);

  return { partnerId, partnerKey, redirectUri, host };
}
