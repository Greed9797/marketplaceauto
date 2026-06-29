import * as Sentry from "@sentry/nextjs";

function isValidSentryDsn(dsn: string | undefined): dsn is string {
  if (!dsn) return false;
  if (dsn.includes("placeholder")) return false;
  // /0 is the sentinel project id we use for placeholder values.
  if (/\/0$/.test(dsn)) return false;
  return true;
}

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (isValidSentryDsn(dsn)) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1 : 0.1,
    // Per-deploy attribution (no-op if the env isn't exposed; the Sentry build
    // plugin also injects a release).
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
