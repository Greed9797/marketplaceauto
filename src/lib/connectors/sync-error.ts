import { ConnectorStatus } from "@prisma/client";

import { MercadoLivreApiError } from "@/lib/connectors/mercado-livre/client";
import { ShopeeApiError } from "@/lib/connectors/shopee/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Connector statuses the background sync will re-attempt on its own.
 * `TOKEN_EXPIRED` / `REVOKED` are deliberately excluded: those mean the OAuth
 * grant itself is dead and only a manual reconnect can recover them — auto-retry
 * would just hammer a dead refresh token. Everything else (ACTIVE, plus the
 * catch-all ERROR) is safe to retry, so a transient blip never strands a
 * connection permanently.
 */
export const RETRYABLE_CONNECTOR_STATUSES = [
  ConnectorStatus.ACTIVE,
  ConnectorStatus.ERROR,
] as const;

/**
 * Raised by the sync's proactive-refresh step so the outer handler can tell a
 * DEAD refresh token (needs reconnect → TOKEN_EXPIRED) apart from a transient
 * failure on the token endpoint (keep the connection ACTIVE, retry next run).
 */
export class ConnectorRefreshError extends Error {
  readonly fatal: boolean;

  constructor(fatal: boolean, cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "connector token refresh failed",
      { cause },
    );
    this.name = "ConnectorRefreshError";
    this.fatal = fatal;
  }
}

function statusOf(error: unknown): number | null {
  if (
    error instanceof MercadoLivreApiError ||
    error instanceof ShopeeApiError
  ) {
    return error.status;
  }
  return null;
}

function bodyOf(error: unknown): string {
  if (
    error instanceof MercadoLivreApiError ||
    error instanceof ShopeeApiError
  ) {
    return error.body ?? "";
  }
  return error instanceof Error ? error.message : "";
}

// Terms that mean "grant dead" in an HTTP 400 token-endpoint body. `unauthorized`
// / `forbidden` are safe here because the 400 already scopes it to the token call.
const AUTH_TERMS_BODY =
  /invalid_grant|invalid_token|invalid_refresh|invalid_access_token|token[_ ]?expired|error_auth|unauthorized|forbidden/i;

// Stricter set for status-less errors (Shopee's HTTP-200-with-logical-error, or
// a bare thrown Error). Deliberately EXCLUDES the broad `unauthorized|forbidden`
// so a non-token logical error ("forbidden action") can't force a reconnect.
const AUTH_TERMS_MESSAGE =
  /invalid_grant|invalid_token|invalid_refresh|invalid_access_token|token[_ ]?expired|error_auth/i;

/**
 * True when the failure means the OAuth grant is dead and a retry can't fix it
 * (the user must reconnect). Covers HTTP 401/403, HTTP 400 with an auth error in
 * the body, and Shopee's HTTP-200-with-logical-error shape (no status → match on
 * the stricter message terms).
 */
export function isAuthFatalError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 401 || status === 403) return true;
  if (status === 400 && AUTH_TERMS_BODY.test(bodyOf(error))) return true;
  if (status === null && AUTH_TERMS_MESSAGE.test(bodyOf(error))) return true;
  return false;
}

// Network / infra hiccups + provider 5xx + rate limiting: recoverable next run.
const TRANSIENT_MSG =
  /network|fetch failed|timeout|timed out|aborted|aborterror|econn|eai_again|socket|rate.?limit|too many requests/i;

function isTransientError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) {
    return status === 429 || status >= 500;
  }
  const message = error instanceof Error ? error.message : "";
  return TRANSIENT_MSG.test(message);
}

export type SyncFailureKind = "auth_fatal" | "transient" | "unknown";

/** Buckets a thrown sync error into an actionable kind. */
export function classifyConnectorSyncError(error: unknown): SyncFailureKind {
  if (error instanceof ConnectorRefreshError) {
    return error.fatal ? "auth_fatal" : "transient";
  }
  if (isAuthFatalError(error)) return "auth_fatal";
  if (isTransientError(error)) return "transient";
  return "unknown";
}

/**
 * The `ConnectorAccount.status` to persist for a failure kind, or `null` to
 * LEAVE the current status untouched. Transient failures return null so the
 * connection stays ACTIVE (no visible "disconnected" flap) and the cron keeps
 * retrying; only a dead grant downgrades to TOKEN_EXPIRED.
 */
export function statusForSyncFailure(
  kind: SyncFailureKind,
): ConnectorStatus | null {
  if (kind === "auth_fatal") return ConnectorStatus.TOKEN_EXPIRED;
  if (kind === "transient") return null;
  return ConnectorStatus.ERROR;
}

// A grant re-read within this window of expiry is still considered dead.
const GRANT_ALIVE_BUFFER_MS = 60 * 1000;

/**
 * Guards the single-use refresh-token race: Mercado Livre rotates (and
 * invalidates) the refresh token on every use, so if a keep-alive run and an
 * order sync refresh the SAME connector concurrently, the loser gets an
 * `invalid_grant` even though the winner already persisted a healthy rotated
 * token. Before downgrading an auth-fatal failure to TOKEN_EXPIRED, re-read the
 * stored expiry: if it now sits comfortably in the future, another process won
 * the race and the grant is alive — the caller must NOT kill the connection.
 * Returns true only when the grant is genuinely still dead.
 */
export async function grantStillDeadAfterRecheck(
  connectorAccountId: string,
): Promise<boolean> {
  const fresh = await prisma.connectorAccount.findUnique({
    where: { id: connectorAccountId },
    select: { tokenExpiresAt: true },
  });
  const expiresAtMs = fresh?.tokenExpiresAt?.getTime() ?? 0;
  return expiresAtMs - Date.now() <= GRANT_ALIVE_BUFFER_MS;
}
