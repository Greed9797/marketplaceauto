import { NextResponse, type NextRequest } from "next/server";

import { rateLimitMiddleware } from "@/lib/security/rate-limit";

const protectedRoutes = [
  "/dashboard",
  "/dashboards",
  "/connectors",
  "/workspace",
  "/profile",
  "/platform",
  "/feedback",
];

const rateLimitedRoutes = [
  ...protectedRoutes,
  "/login",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/api/connectors",
  "/api/webhooks",
];

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function createCspHeader(nonce: string) {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    "https://*.posthog.com",
    "https://*.sentry.io",
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co https://*.posthog.com https://*.sentry.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.NODE_ENV === "production"
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; ");
}

function withCsp(response: NextResponse, cspHeader: string) {
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
}

async function runMiddleware(
  request: NextRequest,
  nonce: string,
  cspHeader: string,
) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute = protectedRoutes.some((route) =>
    matchesRoute(pathname, route),
  );

  // Auth gate FIRST — unauthenticated requests to protected routes should
  // not consume the rate-limit budget. Redirect to /login immediately.
  if (isProtectedRoute) {
    const hasSession =
      request.cookies.has("authjs.session-token") ||
      request.cookies.has("__Secure-authjs.session-token") ||
      request.cookies.has("next-auth.session-token") ||
      request.cookies.has("__Secure-next-auth.session-token");

    if (!hasSession) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "callbackUrl",
        `${pathname}${request.nextUrl.search}`,
      );

      return withCsp(NextResponse.redirect(loginUrl), cspHeader);
    }
  }

  // Rate-limit AFTER auth check:
  // - Authenticated requests on protected paths still get rate-limited
  // - Public auth paths (/login, /sign-up, /api/auth/*, /api/webhooks/*) get DOS protection
  if (rateLimitedRoutes.some((route) => matchesRoute(pathname, route))) {
    const rateLimitResponse = await rateLimitMiddleware(request);
    if (rateLimitResponse) {
      return withCsp(rateLimitResponse, cspHeader);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  return withCsp(
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
    cspHeader,
  );
}

export async function middleware(request: NextRequest) {
  const nonce = createNonce();
  const cspHeader = createCspHeader(nonce);

  // Fail-open: middleware must never 500 the whole app. Any unhandled error
  // (rate-limiter infra, edge runtime quirk) degrades to a plain pass-through
  // with the security headers still attached.
  try {
    return await runMiddleware(request, nonce, cspHeader);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[middleware] failing open: ${message}`);
    return withCsp(NextResponse.next(), cspHeader);
  }
}

export const config = {
  // Run on application routes so dynamic pages receive a per-request CSP nonce.
  // Static assets and Next internals are excluded.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
