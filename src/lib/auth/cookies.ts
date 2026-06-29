export function getAuthSessionCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

export function getStrictCookieOptions(options?: {
  path?: string;
  maxAge?: number;
  expires?: Date;
}) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: options?.path ?? "/",
    ...(options?.maxAge === undefined ? {} : { maxAge: options.maxAge }),
    ...(options?.expires === undefined ? {} : { expires: options.expires }),
  };
}

/**
 * Lax variant for non-CSRF-sensitive preference cookies (e.g. the selected
 * workspace). `sameSite=strict` is dropped on top-level cross-site GET
 * navigations — which is exactly what an OAuth provider redirect back to our
 * callback is. A strict workspace cookie therefore vanishes on return from
 * Google, and `getCurrentUserContext` falls back to the first membership,
 * attaching the connector to the wrong workspace. `lax` survives that return
 * while still blocking cross-site POST/CSRF. The membership is always
 * re-validated server-side, so this carries no privilege risk.
 */
export function getLaxCookieOptions(options?: {
  path?: string;
  maxAge?: number;
  expires?: Date;
}) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: options?.path ?? "/",
    ...(options?.maxAge === undefined ? {} : { maxAge: options.maxAge }),
    ...(options?.expires === undefined ? {} : { expires: options.expires }),
  };
}
