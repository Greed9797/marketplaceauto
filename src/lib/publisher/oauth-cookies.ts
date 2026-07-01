import { type NextResponse } from "next/server";

/**
 * Cookie names carrying the publisher OAuth handshake across the cross-site
 * redirect to Shopee / Mercado Livre. `*_CLIENTE` holds the target cliente id;
 * `*_STATE` holds a random CSRF nonce echoed back in the `state` query param.
 */
export const SHOPEE_CLIENTE_COOKIE = "w3pub_shopee_cliente";
export const SHOPEE_STATE_COOKIE = "w3pub_shopee_state";
export const ML_CLIENTE_COOKIE = "w3pub_ml_cliente";
export const ML_STATE_COOKIE = "w3pub_ml_state";

/** 10 minutes — the OAuth round-trip should complete well within this. */
const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function setOAuthCookie(
  response: NextResponse,
  name: string,
  value: string,
) {
  response.cookies.set(name, value, {
    ...baseCookieOptions(),
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearOAuthCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", { ...baseCookieOptions(), maxAge: 0 });
}
