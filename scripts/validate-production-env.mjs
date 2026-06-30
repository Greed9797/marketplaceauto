const requiredProductionEnvGroups = [
  {
    keys: ["AUTH_SECRET", "NEXTAUTH_SECRET"],
    message: "AUTH_SECRET or NEXTAUTH_SECRET is required in production.",
    any: true,
  },
  {
    keys: ["NEXTAUTH_URL"],
    message: "NEXTAUTH_URL is required in production.",
  },
  {
    keys: ["AUTH_TRUST_HOST"],
    message: "AUTH_TRUST_HOST=true is required in production.",
  },
  {
    keys: ["DATABASE_URL"],
    message: "DATABASE_URL is required in production.",
  },
  {
    keys: ["DIRECT_URL"],
    message: "DIRECT_URL is required in production.",
  },
  {
    keys: ["SUPABASE_URL"],
    message: "SUPABASE_URL is required in production.",
  },
  {
    keys: ["SUPABASE_ANON_KEY"],
    message: "SUPABASE_ANON_KEY is required in production.",
  },
  {
    keys: ["SUPABASE_SERVICE_ROLE_KEY"],
    message: "SUPABASE_SERVICE_ROLE_KEY is required in production.",
  },
  {
    keys: ["GOOGLE_OAUTH_CLIENT_ID"],
    message: "GOOGLE_OAUTH_CLIENT_ID is required in production.",
  },
  {
    keys: ["GOOGLE_OAUTH_CLIENT_SECRET"],
    message: "GOOGLE_OAUTH_CLIENT_SECRET is required in production.",
  },
  // Resend (e-mail transacional) é OPCIONAL nesta versão interna — reset de
  // senha e convites são geridos manualmente pelo admin. sendTransactionalEmail
  // faz no-op sem RESEND_API_KEY.
  {
    keys: ["UPSTASH_REDIS_REST_URL"],
    message: "UPSTASH_REDIS_REST_URL is required in production.",
  },
  {
    keys: ["UPSTASH_REDIS_REST_TOKEN"],
    message: "UPSTASH_REDIS_REST_TOKEN is required in production.",
  },
  {
    keys: ["INNGEST_EVENT_KEY"],
    message: "INNGEST_EVENT_KEY is required in production.",
  },
  {
    keys: ["INNGEST_SIGNING_KEY"],
    message: "INNGEST_SIGNING_KEY is required in production.",
  },
  {
    keys: ["TOKEN_ENCRYPTION_KEY"],
    message:
      "TOKEN_ENCRYPTION_KEY (32-byte base64) is required in production for connector token encryption.",
  },
  {
    keys: ["CRON_SECRET"],
    message:
      "CRON_SECRET is required in production to authorize Vercel cron invocations.",
  },
  // Observability is optional: Sentry and PostHog only initialize when their
  // env vars are present (guarded in instrumentation/analytics), so a missing
  // value disables them with zero runtime overhead — never blocks the build.
  {
    keys: ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"],
    message: "SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN is recommended in production.",
    any: true,
    optional: true,
  },
  {
    keys: ["NEXT_PUBLIC_POSTHOG_KEY"],
    message: "NEXT_PUBLIC_POSTHOG_KEY is recommended in production.",
    optional: true,
  },
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function shouldValidateProductionEnv(env = process.env) {
  // Skip in Vercel preview/development builds — those don't have full prod env.
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") {
    return false;
  }

  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function productionEnvErrors(env = process.env) {
  if (!shouldValidateProductionEnv(env)) {
    return [];
  }

  const errors = [];

  if (env.AUTH_DISABLED === "true") {
    errors.push("AUTH_DISABLED must be false or empty in production.");
  }

  if (env.AUTH_TRUST_HOST && env.AUTH_TRUST_HOST !== "true") {
    errors.push("AUTH_TRUST_HOST must be true in production.");
  }

  if (hasText(env.NEXTAUTH_URL) && !env.NEXTAUTH_URL.startsWith("https://")) {
    errors.push("NEXTAUTH_URL must use https in production.");
  }

  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    if (hasText(env[key]) && !env[key].includes("schema=w3marketplace")) {
      errors.push(`${key} must include schema=w3marketplace in production.`);
    }
  }

  // Connection pooling: in serverless production the app MUST connect through
  // the Supabase transaction pooler (pgbouncer, port 6543); DIRECT_URL stays on
  // the direct 5432 connection for migrations. A misconfigured pool exhausts
  // Postgres connections under load.
  const dbUrl = env.DATABASE_URL ?? "";
  const directUrl = env.DIRECT_URL ?? "";
  if (hasText(dbUrl)) {
    const pooled =
      dbUrl.includes("pooler") ||
      dbUrl.includes(":6543") ||
      dbUrl.includes("pgbouncer=true");
    if (!pooled) {
      errors.push(
        "DATABASE_URL must use the Supabase transaction pooler (pgbouncer / port 6543) in serverless production.",
      );
    }
  }
  if (
    hasText(directUrl) &&
    (directUrl.includes(":6543") || directUrl.includes("pgbouncer=true"))
  ) {
    errors.push(
      "DIRECT_URL must be the direct (non-pooled, port 5432) connection, not the pgbouncer pooler.",
    );
  }
  if (hasText(dbUrl) && hasText(directUrl) && dbUrl === directUrl) {
    errors.push(
      "DATABASE_URL and DIRECT_URL must differ — pooled (6543) vs direct (5432).",
    );
  }

  for (const group of requiredProductionEnvGroups) {
    if (group.optional) {
      continue;
    }

    const configured = group.any
      ? group.keys.some((key) => hasText(env[key]))
      : group.keys.every((key) => hasText(env[key]));

    if (!configured) {
      errors.push(group.message);
    }
  }

  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = productionEnvErrors();

  if (errors.length > 0) {
    console.error(["Production environment is not ready:", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exit(1);
  }
}
