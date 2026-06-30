import { describe, expect, it } from "vitest";

import {
  productionEnvErrors,
  shouldValidateProductionEnv,
} from "../../scripts/validate-production-env.mjs";

describe("production env validation", () => {
  it("fails production builds when auth bypass is enabled", () => {
    expect(
      productionEnvErrors({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        AUTH_DISABLED: "true",
        AUTH_SECRET: "secret",
        NEXTAUTH_URL: "https://w3ads.vercel.app",
        AUTH_TRUST_HOST: "true",
        DATABASE_URL: "postgresql://db?schema=w3marketplace",
        DIRECT_URL: "postgresql://db?schema=w3marketplace",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        RESEND_API_KEY: "resend",
        RESEND_FROM_EMAIL: "Adstart W3 <no-reply@w3educacao.com.br>",
        UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "redis",
        INNGEST_EVENT_KEY: "inngest-event",
        INNGEST_SIGNING_KEY: "inngest-signing",
        TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        CRON_SECRET: "cron-secret",
        SENTRY_DSN: "https://sentry.example",
        NEXT_PUBLIC_POSTHOG_KEY: "posthog",
      }),
    ).toContain("AUTH_DISABLED must be false or empty in production.");
  });

  it("requires the operational production envs that cannot be configured in the app", () => {
    expect(
      productionEnvErrors({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        AUTH_DISABLED: "false",
      }),
    ).toEqual([
      "AUTH_SECRET or NEXTAUTH_SECRET is required in production.",
      "NEXTAUTH_URL is required in production.",
      "AUTH_TRUST_HOST=true is required in production.",
      "DATABASE_URL is required in production.",
      "DIRECT_URL is required in production.",
      "SUPABASE_URL is required in production.",
      "SUPABASE_ANON_KEY is required in production.",
      "SUPABASE_SERVICE_ROLE_KEY is required in production.",
      "GOOGLE_OAUTH_CLIENT_ID is required in production.",
      "GOOGLE_OAUTH_CLIENT_SECRET is required in production.",
      "UPSTASH_REDIS_REST_URL is required in production.",
      "UPSTASH_REDIS_REST_TOKEN is required in production.",
      "INNGEST_EVENT_KEY is required in production.",
      "INNGEST_SIGNING_KEY is required in production.",
      "TOKEN_ENCRYPTION_KEY (32-byte base64) is required in production for connector token encryption.",
      "CRON_SECRET is required in production to authorize Vercel cron invocations.",
    ]);
  });

  it("requires secure production URLs and the isolated Supabase schema", () => {
    expect(
      productionEnvErrors({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        AUTH_DISABLED: "false",
        AUTH_SECRET: "secret",
        NEXTAUTH_URL: "http://w3ads.vercel.app",
        AUTH_TRUST_HOST: "false",
        DATABASE_URL: "postgresql://db",
        DIRECT_URL: "postgresql://db?schema=public",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        RESEND_API_KEY: "resend",
        RESEND_FROM_EMAIL: "Adstart W3 <no-reply@w3educacao.com.br>",
        UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "redis",
        INNGEST_EVENT_KEY: "inngest-event",
        INNGEST_SIGNING_KEY: "inngest-signing",
        TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        CRON_SECRET: "cron-secret",
        NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example",
        NEXT_PUBLIC_POSTHOG_KEY: "posthog",
      }),
    ).toEqual([
      "AUTH_TRUST_HOST must be true in production.",
      "NEXTAUTH_URL must use https in production.",
      "DATABASE_URL must include schema=w3marketplace in production.",
      "DIRECT_URL must include schema=w3marketplace in production.",
      "DATABASE_URL must use the Supabase transaction pooler (pgbouncer / port 6543) in serverless production.",
    ]);
  });

  it("requires the app to connect through the pooler, not the direct connection", () => {
    const base = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      AUTH_DISABLED: "false",
      AUTH_SECRET: "secret",
      NEXTAUTH_URL: "https://w3ads.vercel.app",
      AUTH_TRUST_HOST: "true",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      RESEND_API_KEY: "resend",
      RESEND_FROM_EMAIL: "Adstart W3 <no-reply@w3educacao.com.br>",
      UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "redis",
      INNGEST_EVENT_KEY: "inngest-event",
      INNGEST_SIGNING_KEY: "inngest-signing",
      TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      CRON_SECRET: "cron-secret",
      NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example",
      NEXT_PUBLIC_POSTHOG_KEY: "posthog",
    };

    // Identical pooled+direct (no pooling) AND direct URL on the pooler.
    expect(
      productionEnvErrors({
        ...base,
        DATABASE_URL:
          "postgresql://u:p@db.pooler.supabase.com:5432/postgres?schema=w3marketplace&pgbouncer=true",
        DIRECT_URL:
          "postgresql://u:p@db.pooler.supabase.com:6543/postgres?schema=w3marketplace",
      }),
    ).toEqual([
      "DIRECT_URL must be the direct (non-pooled, port 5432) connection, not the pgbouncer pooler.",
    ]);

    // A correct pooled/direct split produces no pooling errors.
    expect(
      productionEnvErrors({
        ...base,
        DATABASE_URL:
          "postgresql://u:p@db.pooler.supabase.com:6543/postgres?schema=w3marketplace&pgbouncer=true",
        DIRECT_URL:
          "postgresql://u:p@db.host.supabase.com:5432/postgres?schema=w3marketplace",
      }),
    ).toEqual([]);
  });

  it("runs only for production-like environments", () => {
    expect(shouldValidateProductionEnv({ NODE_ENV: "development" })).toBe(
      false,
    );
    expect(shouldValidateProductionEnv({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldValidateProductionEnv({ NODE_ENV: "production" })).toBe(true);
    expect(shouldValidateProductionEnv({ VERCEL_ENV: "production" })).toBe(
      true,
    );
  });
});
