import * as Sentry from "@sentry/nextjs";

function isValidSentryDsn(dsn: string | undefined): boolean {
  if (!dsn) return false;
  if (dsn.includes("placeholder")) return false;
  if (/\/0$/.test(dsn)) return false;
  return true;
}

export async function register() {
  // Fail-fast: refuse to boot in production if encryption keys are missing.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_RUNTIME === "nodejs"
  ) {
    const { getTokenEncryptionKey } = await import("@/lib/crypto/token-vault");
    getTokenEncryptionKey();

    if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
      throw new Error(
        "AUTH_SECRET (ou NEXTAUTH_SECRET) é obrigatório em produção.",
      );
    }
  }

  // Skip Sentry server init when DSN is missing/placeholder — avoids loading
  // the ~2MB Sentry runtime on every cold start.
  if (!isValidSentryDsn(process.env.SENTRY_DSN)) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
