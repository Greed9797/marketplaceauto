import { describe, expect, it } from "vitest";

import {
  buildPublicBaseString,
  buildShopBaseString,
  shopeeHmacHex,
  signPublicRequest,
  signShopRequest,
} from "@/lib/connectors/shopee/signer";

// Fixed known-answer vector. The expected hex was computed independently with
// the documented formula:
//   public: HMAC-SHA256(partner_key, partner_id + api_path + timestamp)
//   shop:   HMAC-SHA256(partner_key, partner_id + api_path + timestamp +
//                       access_token + shop_id)
const PARTNER_KEY = "shopee-partner-key-test";
const PARTNER_ID = 2000123;
const TIMESTAMP = 1700000000;
const PUBLIC_PATH = "/api/v2/shop/auth_partner";
const SHOP_PATH = "/api/v2/order/get_order_list";
const ACCESS_TOKEN = "ACCESSTOKEN123";
const SHOP_ID = 99887766;

const EXPECTED_PUBLIC_SIGN =
  "195f2ba388535fea2509e29a942b7737561e0c566c354804bb25d39300485fce";
const EXPECTED_SHOP_SIGN =
  "11bfa930476536d8985b198b0e4ea7d80c0ed6cdecbfc948b585ea16bc12fdea";

describe("Shopee request signer", () => {
  it("signs public endpoints as HMAC-SHA256(partner_id+path+timestamp)", () => {
    expect(
      buildPublicBaseString({
        partnerId: PARTNER_ID,
        apiPath: PUBLIC_PATH,
        timestamp: TIMESTAMP,
      }),
    ).toBe(`${PARTNER_ID}${PUBLIC_PATH}${TIMESTAMP}`);

    expect(
      signPublicRequest({
        partnerId: PARTNER_ID,
        partnerKey: PARTNER_KEY,
        apiPath: PUBLIC_PATH,
        timestamp: TIMESTAMP,
      }),
    ).toBe(EXPECTED_PUBLIC_SIGN);
  });

  it("signs shop endpoints with access_token + shop_id appended", () => {
    expect(
      buildShopBaseString({
        partnerId: PARTNER_ID,
        apiPath: SHOP_PATH,
        timestamp: TIMESTAMP,
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
      }),
    ).toBe(`${PARTNER_ID}${SHOP_PATH}${TIMESTAMP}${ACCESS_TOKEN}${SHOP_ID}`);

    expect(
      signShopRequest({
        partnerId: PARTNER_ID,
        partnerKey: PARTNER_KEY,
        apiPath: SHOP_PATH,
        timestamp: TIMESTAMP,
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
      }),
    ).toBe(EXPECTED_SHOP_SIGN);
  });

  it("produces different base strings and signatures for the two schemes", () => {
    const publicBase = buildPublicBaseString({
      partnerId: PARTNER_ID,
      apiPath: SHOP_PATH,
      timestamp: TIMESTAMP,
    });
    const shopBase = buildShopBaseString({
      partnerId: PARTNER_ID,
      apiPath: SHOP_PATH,
      timestamp: TIMESTAMP,
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    // Same partner/path/timestamp, but the shop scheme appends token + shop id.
    expect(publicBase).not.toBe(shopBase);
    expect(shopeeHmacHex(PARTNER_KEY, publicBase)).not.toBe(
      shopeeHmacHex(PARTNER_KEY, shopBase),
    );
  });

  it("is deterministic and lowercase hex of length 64", () => {
    const sign = signPublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: PUBLIC_PATH,
      timestamp: TIMESTAMP,
    });
    expect(sign).toMatch(/^[0-9a-f]{64}$/);
    expect(sign).toBe(
      signPublicRequest({
        partnerId: PARTNER_ID,
        partnerKey: PARTNER_KEY,
        apiPath: PUBLIC_PATH,
        timestamp: TIMESTAMP,
      }),
    );
  });
});
