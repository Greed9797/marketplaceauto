import { Ratelimit } from "@upstash/ratelimit";
// Edge-runtime build (middleware runs on the Edge runtime). The default "."
// export is the Node build and pulls Node APIs the Edge bundler rejects.
import { Redis } from "@upstash/redis/cloudflare";
import { NextResponse, type NextRequest } from "next/server";

type EnvLike = Partial<NodeJS.ProcessEnv>;

export type RateLimitTarget = {
  keyPrefix: "auth" | "connectors" | "webhooks" | "observability";
  limit: number;
  window: `${number} ${"s" | "m" | "h"}`;
};

const authPaths = new Set([
  "/login",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
]);

function isProductionLike(env: EnvLike) {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function classifyRateLimitTarget(input: {
  pathname: string;
  method: string;
}): RateLimitTarget | null {
  const method = input.method.toUpperCase();

  if (
    input.pathname.startsWith("/api/auth") ||
    (method === "POST" && authPaths.has(input.pathname))
  ) {
    return { keyPrefix: "auth", limit: 10, window: "15 m" };
  }

  if (input.pathname.startsWith("/api/connectors")) {
    return { keyPrefix: "connectors", limit: 60, window: "1 m" };
  }

  if (input.pathname.startsWith("/api/webhooks")) {
    return { keyPrefix: "webhooks", limit: 300, window: "1 m" };
  }

  if (input.pathname.startsWith("/api/observability")) {
    // Client-error ingest: bound per client so a single browser/script can't
    // flood the audit log. The route also requires an authenticated session.
    return { keyPrefix: "observability", limit: 30, window: "1 m" };
  }

  return null;
}

function isPlaceholderUpstash(env: EnvLike) {
  const url = env.UPSTASH_REDIS_REST_URL ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? "";
  return url.includes("placeholder") || token.includes("placeholder");
}

export function rateLimitConfigError(env: EnvLike = process.env) {
  if (!isProductionLike(env)) {
    return null;
  }

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for production rate limiting.";
  }

  return null;
}

/**
 * Whether a rate-limit failure on this target must fail CLOSED (block) instead
 * of OPEN (allow). Auth endpoints in production fail closed — a disabled or
 * unreachable limiter there enables credential-stuffing. Everything else fails
 * open so an Upstash blip can't break sync/webhooks.
 */
export function shouldFailClosed(
  target: RateLimitTarget,
  env: EnvLike = process.env,
) {
  return target.keyPrefix === "auth" && isProductionLike(env);
}

export function shouldSkipRateLimit(env: EnvLike = process.env) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return true;
  }

  // Placeholder Upstash credentials would hang every request on DNS/TCP.
  // Fail-open until real credentials are configured.
  return isPlaceholderUpstash(env);
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const ratelimitCache = new Map<string, Ratelimit>();

function rateLimiterFor(target: RateLimitTarget) {
  const key = `${target.keyPrefix}:${target.limit}:${target.window}`;
  const cached = ratelimitCache.get(key);

  if (cached) {
    return cached;
  }

  // Instantiate explicitly from process.env rather than Redis.fromEnv(): the
  // Cloudflare build's fromEnv() reads a Workers env binding, not process.env,
  // so on Vercel it yields an unconfigured client whose .limit() throws. On the
  // Vercel Edge runtime process.env still exposes these vars. Reaching here
  // means the config/placeholder guards already verified both are present.
  const limiter = new Ratelimit({
    redis: new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL ?? "",
      token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
    }),
    limiter: Ratelimit.slidingWindow(target.limit, target.window),
    analytics: true,
    prefix: `w3ads:${target.keyPrefix}`,
  });
  ratelimitCache.set(key, limiter);

  return limiter;
}

function rateLimitUnavailableResponse() {
  return NextResponse.json(
    {
      error: "rate_limit_unavailable",
      message: "Rate limiting indisponível. Tente novamente em instantes.",
    },
    { status: 503 },
  );
}

export async function rateLimitMiddleware(request: NextRequest) {
  const target = classifyRateLimitTarget({
    pathname: request.nextUrl.pathname,
    method: request.method,
  });

  if (!target) {
    return null;
  }

  // Auth endpoints (login/sign-up/forgot/reset + /api/auth) must fail CLOSED in
  // production: a disabled or unreachable limiter on these routes opens the door
  // to credential-stuffing / brute-force. Connectors/webhooks keep failing OPEN
  // so an Upstash blip never breaks sync.
  const failClosed = shouldFailClosed(target);

  const configError = rateLimitConfigError();
  if (configError) {
    return NextResponse.json(
      {
        error: "rate_limit_not_configured",
        message: configError,
      },
      { status: 503 },
    );
  }

  // Placeholder creds would hang on DNS/TCP, so the limiter is skipped — but for
  // auth in prod a silently-disabled limiter is a vulnerability, not a skip.
  if (isPlaceholderUpstash(process.env)) {
    return failClosed ? rateLimitUnavailableResponse() : null;
  }

  if (shouldSkipRateLimit()) {
    return null;
  }

  // Compose key from IP + (opaque) session-token hash + pathname. Sharing a
  // NAT (CGNAT, office, school) used to throttle every legit user behind the
  // same IP; with the session-bound discriminator each authenticated user
  // gets their own bucket, while unauthenticated callers still share the IP
  // bucket (which is the safer default for login/forgot-password floods).
  const sessionCookie =
    request.cookies.get("__Secure-authjs.session-token")?.value ??
    request.cookies.get("authjs.session-token")?.value ??
    "";
  const sessionFingerprint = sessionCookie
    ? (await sha256Hex(sessionCookie)).slice(0, 16)
    : "anon";

  // A limiter infra error (Upstash unreachable, bad edge client init, etc.) must
  // NEVER 500 the whole middleware. For non-auth routes we fail OPEN (log + allow)
  // so a blip can't break the app; for auth routes in prod we fail CLOSED (503)
  // rather than leave login unthrottled.
  try {
    const result = await rateLimiterFor(target).limit(
      `${target.keyPrefix}:${clientIp(request)}:${sessionFingerprint}:${request.nextUrl.pathname}`,
    );

    if (result.success) {
      return null;
    }

    return NextResponse.json(
      {
        error: "rate_limited",
        reset: result.reset,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
          ),
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(
      `[rate-limit] limiter error (${failClosed ? "failing closed" : "failing open"}): ${message}`,
    );
    return failClosed ? rateLimitUnavailableResponse() : null;
  }
}
