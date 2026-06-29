import * as Sentry from "@sentry/nextjs";

function isValidSentryDsn(dsn: string | undefined): dsn is string {
  if (!dsn) return false;
  if (dsn.includes("placeholder")) return false;
  if (/\/0$/.test(dsn)) return false;
  return true;
}

const dsn = process.env.SENTRY_DSN;

if (isValidSentryDsn(dsn)) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1 : 0.1,
  });
}
