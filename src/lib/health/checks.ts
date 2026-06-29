import { Prisma, type PrismaClient } from "@prisma/client";

type HealthEnv = Partial<NodeJS.ProcessEnv>;
type FetchLike = typeof fetch;

export type HealthCheck = {
  ok: boolean;
  status: string;
};

export type OperationalHealth = {
  ok: boolean;
  service: "adstart-w3";
  timestamp: string;
  checks: {
    authMode: HealthCheck;
    database: HealthCheck;
    vault: HealthCheck;
    inngest: HealthCheck;
    redis: HealthCheck;
  };
};

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

function checkAuthMode(env: HealthEnv): HealthCheck {
  if ((env.NODE_ENV === "production" || env.VERCEL_ENV === "production") && env.AUTH_DISABLED === "true") {
    return { ok: false, status: "auth_disabled" };
  }

  return { ok: true, status: "enabled" };
}

function checkConfigured(env: HealthEnv, keys: string[]): HealthCheck {
  const configured = keys.every((key) => hasText(env[key]));

  return configured
    ? { ok: true, status: "configured" }
    : { ok: false, status: "not_configured" };
}

async function checkDatabase(prisma: PrismaClient): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1 AS ok`);

    return { ok: true, status: "reachable" };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

async function checkVault(prisma: PrismaClient): Promise<HealthCheck> {
  try {
    const rows = await prisma.$queryRaw<Array<{ installed: boolean }>>(Prisma.sql`
      SELECT to_regclass('vault.secrets') IS NOT NULL AS installed
    `);
    const installed = Boolean(rows[0]?.installed);

    return installed
      ? { ok: true, status: "installed" }
      : { ok: false, status: "not_installed" };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

async function checkRedis(input: {
  env: HealthEnv;
  fetchImpl: FetchLike;
}): Promise<HealthCheck> {
  const url = input.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const token = input.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return { ok: false, status: "not_configured" };
  }

  try {
    const response = await input.fetchImpl(`${url}/get/w3ads:health`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.ok
      ? { ok: true, status: "reachable" }
      : { ok: false, status: `http_${response.status}` };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

export async function getOperationalHealth(input: {
  prisma: PrismaClient;
  fetchImpl?: FetchLike;
  env?: HealthEnv;
  now?: Date;
}): Promise<OperationalHealth> {
  const env = input.env ?? process.env;
  const checks = {
    authMode: checkAuthMode(env),
    database: await checkDatabase(input.prisma),
    vault: await checkVault(input.prisma),
    inngest: checkConfigured(env, ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]),
    redis: await checkRedis({
      env,
      fetchImpl: input.fetchImpl ?? fetch,
    }),
  };

  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: "adstart-w3",
    timestamp: (input.now ?? new Date()).toISOString(),
    checks,
  };
}
