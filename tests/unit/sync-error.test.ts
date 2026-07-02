import { ConnectorStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { MercadoLivreApiError } from "@/lib/connectors/mercado-livre/client";
import { ShopeeApiError } from "@/lib/connectors/shopee/client";
import {
  ConnectorRefreshError,
  RETRYABLE_CONNECTOR_STATUSES,
  classifyConnectorSyncError,
  isAuthFatalError,
  statusForSyncFailure,
} from "@/lib/connectors/sync-error";

describe("classifyConnectorSyncError", () => {
  it("treats a dead grant as auth_fatal (ML 401, ML 400 invalid_grant, Shopee logical)", () => {
    expect(
      classifyConnectorSyncError(new MercadoLivreApiError(401, "unauthorized")),
    ).toBe("auth_fatal");
    expect(
      classifyConnectorSyncError(
        new MercadoLivreApiError(400, '{"error":"invalid_grant"}'),
      ),
    ).toBe("auth_fatal");
    // Shopee returns HTTP 200 + logical error string → thrown as a plain Error.
    expect(
      classifyConnectorSyncError(
        new Error("Shopee API error: invalid_refresh_token - token dead"),
      ),
    ).toBe("auth_fatal");
  });

  it("treats provider 5xx / 429 / network blips as transient", () => {
    expect(
      classifyConnectorSyncError(new MercadoLivreApiError(500, "server error")),
    ).toBe("transient");
    expect(
      classifyConnectorSyncError(new ShopeeApiError(503, "unavailable")),
    ).toBe("transient");
    expect(
      classifyConnectorSyncError(new MercadoLivreApiError(429, "slow down")),
    ).toBe("transient");
    expect(classifyConnectorSyncError(new Error("fetch failed"))).toBe(
      "transient",
    );
    expect(classifyConnectorSyncError(new Error("connection timeout"))).toBe(
      "transient",
    );
  });

  it("propagates the ConnectorRefreshError fatal flag", () => {
    expect(
      classifyConnectorSyncError(
        new ConnectorRefreshError(
          true,
          new MercadoLivreApiError(400, "invalid_grant"),
        ),
      ),
    ).toBe("auth_fatal");
    expect(
      classifyConnectorSyncError(
        new ConnectorRefreshError(false, new MercadoLivreApiError(500, "oops")),
      ),
    ).toBe("transient");
  });

  it("falls back to unknown for an unclassified error", () => {
    expect(classifyConnectorSyncError(new Error("boom"))).toBe("unknown");
  });
});

describe("statusForSyncFailure", () => {
  it("downgrades only dead grants; transient keeps status; unknown → ERROR", () => {
    expect(statusForSyncFailure("auth_fatal")).toBe(
      ConnectorStatus.TOKEN_EXPIRED,
    );
    expect(statusForSyncFailure("transient")).toBeNull();
    expect(statusForSyncFailure("unknown")).toBe(ConnectorStatus.ERROR);
  });
});

describe("isAuthFatalError", () => {
  it("is true for 401/403 and false for 5xx/generic", () => {
    expect(isAuthFatalError(new ShopeeApiError(403, "forbidden"))).toBe(true);
    expect(isAuthFatalError(new ShopeeApiError(500, "err"))).toBe(false);
    expect(isAuthFatalError(new Error("random"))).toBe(false);
  });

  it("does not force a reconnect on a status-less broad 'forbidden'/'unauthorized'", () => {
    // Shopee logical errors carry no HTTP status; a non-token 'forbidden action'
    // must NOT be mistaken for a dead grant.
    expect(isAuthFatalError(new Error("forbidden: action not allowed"))).toBe(
      false,
    );
    expect(isAuthFatalError(new Error("unauthorized endpoint"))).toBe(false);
    // ...but a token-specific logical error still does.
    expect(isAuthFatalError(new Error("error_auth: token invalid"))).toBe(true);
  });
});

describe("RETRYABLE_CONNECTOR_STATUSES", () => {
  it("retries ACTIVE and ERROR but never a dead grant", () => {
    expect(RETRYABLE_CONNECTOR_STATUSES).toContain(ConnectorStatus.ACTIVE);
    expect(RETRYABLE_CONNECTOR_STATUSES).toContain(ConnectorStatus.ERROR);
    expect(RETRYABLE_CONNECTOR_STATUSES).not.toContain(
      ConnectorStatus.TOKEN_EXPIRED,
    );
    expect(RETRYABLE_CONNECTOR_STATUSES).not.toContain(ConnectorStatus.REVOKED);
  });
});
