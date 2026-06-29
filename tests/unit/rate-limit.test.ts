import { describe, expect, it } from "vitest";

import {
  classifyRateLimitTarget,
  rateLimitConfigError,
  shouldFailClosed,
  type RateLimitTarget,
} from "@/lib/security/rate-limit";

const authTarget: RateLimitTarget = {
  keyPrefix: "auth",
  limit: 10,
  window: "15 m",
};
const connectorsTarget: RateLimitTarget = {
  keyPrefix: "connectors",
  limit: 60,
  window: "1 m",
};

describe("production rate limit helpers", () => {
  it("classifies sensitive auth, connector and webhook requests", () => {
    expect(
      classifyRateLimitTarget({ pathname: "/login", method: "POST" }),
    ).toMatchObject({
      keyPrefix: "auth",
      limit: 10,
    });
    expect(
      classifyRateLimitTarget({
        pathname: "/api/auth/callback/google",
        method: "POST",
      }),
    ).toMatchObject({
      keyPrefix: "auth",
      limit: 10,
    });
    expect(
      classifyRateLimitTarget({
        pathname: "/api/connectors/meta/callback",
        method: "GET",
      }),
    ).toMatchObject({
      keyPrefix: "connectors",
      limit: 60,
    });
    expect(
      classifyRateLimitTarget({
        pathname: "/api/webhooks/shopify",
        method: "POST",
      }),
    ).toMatchObject({
      keyPrefix: "webhooks",
      limit: 300,
    });
  });

  it("does not rate limit normal navigation GETs", () => {
    expect(
      classifyRateLimitTarget({ pathname: "/dashboard", method: "GET" }),
    ).toBeNull();
    expect(
      classifyRateLimitTarget({ pathname: "/login", method: "GET" }),
    ).toBeNull();
  });

  it("treats missing Upstash envs as production misconfiguration", () => {
    expect(rateLimitConfigError({ NODE_ENV: "production" })).toBe(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for production rate limiting.",
    );
    expect(
      rateLimitConfigError({
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: "https://redis.example.com",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
    ).toBeNull();
  });

  it("fails CLOSED for auth routes in production", () => {
    expect(shouldFailClosed(authTarget, { NODE_ENV: "production" })).toBe(true);
    expect(shouldFailClosed(authTarget, { VERCEL_ENV: "production" })).toBe(
      true,
    );
  });

  it("fails OPEN for auth routes outside production", () => {
    expect(shouldFailClosed(authTarget, { NODE_ENV: "development" })).toBe(
      false,
    );
    expect(shouldFailClosed(authTarget, { VERCEL_ENV: "preview" })).toBe(false);
  });

  it("fails OPEN for connectors/webhooks even in production", () => {
    expect(shouldFailClosed(connectorsTarget, { NODE_ENV: "production" })).toBe(
      false,
    );
  });
});
