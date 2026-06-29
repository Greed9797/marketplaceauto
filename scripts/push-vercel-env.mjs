import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const envFile = process.argv[2] ?? ".env.production.local";
const target = process.argv[3] ?? "production";

const requiredKeys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "AUTH_TRUST_HOST",
  "AUTH_DISABLED",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
];

const optionalKeys = [
  "NEXTAUTH_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "POSTHOG_API_KEY",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
];

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(contents) {
  const env = new Map();

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquote(trimmed.slice(separatorIndex + 1));
    if (key) {
      env.set(key, value);
    }
  }

  return env;
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    input,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });

  return result.status ?? 1;
}

if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Create it from .env.example and fill production values.`);
  process.exit(1);
}

const env = parseEnvFile(readFileSync(envFile, "utf8"));
const missing = requiredKeys.filter((key) => !env.get(key)?.trim());

if (missing.length > 0) {
  console.error(["Missing required production envs:", ...missing.map((key) => `- ${key}`)].join("\n"));
  process.exit(1);
}

const keysToPush = [...requiredKeys, ...optionalKeys].filter((key) => env.has(key) && env.get(key)?.trim());

for (const key of keysToPush) {
  console.log(`Syncing ${key} to Vercel ${target}...`);
  run("npx", ["vercel", "env", "rm", key, target, "--yes"]);
  const status = run("npx", ["vercel", "env", "add", key, target], `${env.get(key)}\n`);
  if (status !== 0) {
    console.error(`Failed to add ${key}.`);
    process.exit(status);
  }
}

console.log(`Synced ${keysToPush.length} env vars to Vercel ${target}.`);
