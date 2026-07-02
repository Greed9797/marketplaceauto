import {
  ConnectorProvider,
  ConnectorStatus,
  type ConnectorAccount,
} from "@prisma/client";

import {
  connectorRefreshTokenFromAccount,
  vaultCredentialFields,
} from "@/lib/connectors/credentials";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { getGlobalMercadoLivreConfig } from "@/lib/connectors/mercado-livre/global-config";
import {
  buildMercadoLivreConfigFromProviderConfig,
  buildShopeeConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { ShopeeClient } from "@/lib/connectors/shopee/client";
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import {
  grantStillDeadAfterRecheck,
  isAuthFatalError,
} from "@/lib/connectors/sync-error";
import { prisma } from "@/lib/db/prisma";

/**
 * Refresh a token this far ahead of its expiry. Access tokens live ~4h (Shopee)
 * to ~6h (Mercado Livre); refreshing when within 2h keeps a valid token warm
 * between the (infrequent) order syncs and, crucially, exercises the rotating
 * refresh token often enough that the provider never expires it for inactivity.
 *
 * NOTE: the proactive-refresh logic here intentionally mirrors the inline
 * refresh in `ecommerce-sync.ts` (Mercado Livre / Shopee blocks). It is kept
 * separate so the keep-alive cron can refresh WITHOUT running a full order sync;
 * if you change the refresh/vault contract, update both places.
 */
export const KEEPALIVE_SKEW_MS = 2 * 60 * 60 * 1000;

export type KeepAliveResult =
  | "refreshed"
  | "skipped"
  | "token_expired"
  | "transient_error"
  | "unsupported";

const SUPPORTED = new Set<ConnectorProvider>([
  ConnectorProvider.MERCADO_LIVRE,
  ConnectorProvider.SHOPEE,
]);

async function markTokenExpired(connectorId: string, message: string) {
  await prisma.connectorAccount.update({
    where: { id: connectorId },
    data: { status: ConnectorStatus.TOKEN_EXPIRED, lastSyncError: message },
  });
}

async function persistRefreshed(input: {
  connector: ConnectorAccount;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  const credentialFields = await vaultCredentialFields({
    workspaceId: input.connector.workspaceId,
    provider: input.connector.provider,
    externalAccountId: input.connector.externalAccountId,
    credentials: { accessToken: input.accessToken },
    refreshToken: input.refreshToken,
    tokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
  });
  await prisma.connectorAccount.update({
    where: { id: input.connector.id },
    data: {
      ...credentialFields,
      status: ConnectorStatus.ACTIVE,
      lastSyncError: null,
    },
  });
}

/**
 * Proactively refreshes a single connector's token when it is near expiry.
 * Never runs an order sync. A dead grant downgrades to TOKEN_EXPIRED (reconnect
 * needed); a transient failure leaves the connection ACTIVE for the next run.
 */
export async function keepAliveRefreshConnector(
  connector: ConnectorAccount,
): Promise<KeepAliveResult> {
  if (!SUPPORTED.has(connector.provider)) return "unsupported";

  const expiresAtMs = connector.tokenExpiresAt?.getTime() ?? null;
  // No known expiry → let the order-sync path handle it (it always refreshes).
  if (expiresAtMs === null) return "skipped";
  if (expiresAtMs - Date.now() > KEEPALIVE_SKEW_MS) return "skipped";

  const refreshToken = await connectorRefreshTokenFromAccount(connector);
  if (!refreshToken) {
    // No refresh token → can only be recovered by reconnecting. But don't stop
    // sync early: while the access token is still usable, leave it ACTIVE and
    // only flag TOKEN_EXPIRED once it has actually (near-)expired.
    const stillUsableMs = 5 * 60 * 1000;
    if (expiresAtMs - Date.now() > stillUsableMs) return "skipped";
    await markTokenExpired(
      connector.id,
      "Keep-alive: token expirado e sem refresh token. Reconecte a integração.",
    );
    return "token_expired";
  }

  try {
    if (connector.provider === ConnectorProvider.MERCADO_LIVRE) {
      const providerConfig = await getActiveProviderConfig({
        workspaceId: connector.workspaceId,
        provider: ConnectorProvider.MERCADO_LIVRE,
      });
      const config = providerConfig
        ? await buildMercadoLivreConfigFromProviderConfig(providerConfig)
        : getGlobalMercadoLivreConfig(process.env.NEXTAUTH_URL?.trim() ?? "");
      if (!config) return "skipped";

      const refreshed = await new MercadoLivreClient({
        config,
      }).refreshAccessToken(refreshToken);
      await persistRefreshed({
        connector,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        expiresIn: refreshed.expiresIn,
      });
      return "refreshed";
    }

    // Shopee
    const shopId = Number(connector.externalAccountId);
    if (!Number.isFinite(shopId) || shopId <= 0) return "skipped";
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPEE,
    });
    const config = providerConfig
      ? await buildShopeeConfigFromProviderConfig(providerConfig)
      : getGlobalShopeeConfig(process.env.NEXTAUTH_URL?.trim() ?? "");
    if (!config) return "skipped";

    const refreshed = await new ShopeeClient({ config }).refreshAccessToken({
      refreshToken,
      shopId,
    });
    await persistRefreshed({
      connector,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresIn: refreshed.expiresIn,
    });
    return "refreshed";
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "keep-alive falhou";
    if (isAuthFatalError(error)) {
      // Single-use refresh-token race: if a concurrent refresh already rotated
      // the token, this invalid_grant is a false alarm — leave the connection.
      if (await grantStillDeadAfterRecheck(connector.id)) {
        await markTokenExpired(connector.id, `Keep-alive: ${message}`);
        return "token_expired";
      }
      return "skipped";
    }
    // Transient — keep the connection ACTIVE, just record the last error.
    await prisma.connectorAccount.update({
      where: { id: connector.id },
      data: { lastSyncError: message },
    });
    return "transient_error";
  }
}
