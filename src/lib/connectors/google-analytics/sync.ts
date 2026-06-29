import { createHash } from "node:crypto";
import { ConnectorProvider, ConnectorStatus, SyncStatus } from "@prisma/client";

import {
  connectorAccessTokenFromAccount,
  connectorRefreshTokenFromAccount,
  vaultCredentialFields,
} from "@/lib/connectors/credentials";
import {
  buildGoogleAnalyticsConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { prisma } from "@/lib/db/prisma";
import {
  buildSyncJobCreateInput,
  type ProductionSyncType,
} from "@/lib/jobs/sync-operations";

import {
  GoogleAnalyticsClient,
  type GoogleAnalyticsSessionMetric,
} from "./client";

export type GoogleAnalyticsSyncRange = {
  since: string;
  until: string;
};

const tokenRefreshSkewMs = 5 * 60 * 1000;

function tokenExpiresAt(expiresInSeconds: number | undefined) {
  return expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000)
    : null;
}

function tokenNeedsRefresh(expiresAt: Date | null, now = new Date()) {
  return Boolean(
    expiresAt && expiresAt.getTime() <= now.getTime() + tokenRefreshSkewMs,
  );
}

function gaDateToIsoDate(value: string) {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  return value;
}

function asDateOnly(value: string) {
  return new Date(`${gaDateToIsoDate(value)}T00:00:00.000Z`);
}

function dedupeHash(input: {
  workspaceId: string;
  connectorAccountId: string;
  date: string;
  sourceMedium: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.workspaceId,
        input.connectorAccountId,
        gaDateToIsoDate(input.date),
        ConnectorProvider.GA4,
        input.sourceMedium,
      ].join(":"),
    )
    .digest("hex");
}

export function mapGoogleAnalyticsSessionToDailyMetric(input: {
  workspaceId: string;
  connectorAccountId: string;
  metric: GoogleAnalyticsSessionMetric;
}) {
  return {
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    date: asDateOnly(input.metric.date),
    source: ConnectorProvider.GA4,
    campaignId: input.metric.sourceMedium,
    campaignName: input.metric.sourceMedium,
    adsetId: null,
    adsetName: null,
    adId: null,
    spend: null,
    impressions: null,
    clicks: null,
    conversions: null,
    conversionsValue: null,
    sessions: BigInt(input.metric.sessions || "0"),
    orders: null,
    revenue: null,
    dedupeHash: dedupeHash({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      date: input.metric.date,
      sourceMedium: input.metric.sourceMedium,
    }),
  };
}

export async function syncGoogleAnalyticsSessions(input: {
  connectorAccountId: string;
  range: GoogleAnalyticsSyncRange;
  syncType?: ProductionSyncType;
}) {
  const connector = await prisma.connectorAccount.findUniqueOrThrow({
    where: { id: input.connectorAccountId },
  });
  const syncJob = await prisma.syncJob.create({
    data: buildSyncJobCreateInput({
      connector,
      syncType: input.syncType ?? "BACKFILL",
      metadata: input.range,
    }),
  });

  try {
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.GA4,
    });
    if (!providerConfig) {
      throw new Error("Google Analytics provider config is missing");
    }
    let accessToken = await connectorAccessTokenFromAccount(connector);
    const client = new GoogleAnalyticsClient({
      config:
        await buildGoogleAnalyticsConfigFromProviderConfig(providerConfig),
    });

    if (tokenNeedsRefresh(connector.tokenExpiresAt)) {
      const refreshToken = await connectorRefreshTokenFromAccount(connector);
      if (!refreshToken) {
        await prisma.connectorAccount.update({
          where: { id: connector.id },
          data: {
            status: ConnectorStatus.TOKEN_EXPIRED,
            lastSyncError: "Google Analytics refresh token is missing",
          },
        });
        throw new Error("Google Analytics refresh token is missing");
      }

      const refreshed = await client.refreshAccessToken(refreshToken);
      const credentialFields = await vaultCredentialFields({
        workspaceId: connector.workspaceId,
        provider: ConnectorProvider.GA4,
        externalAccountId: connector.externalAccountId,
        credentials: { accessToken: refreshed.access_token },
        refreshToken: refreshed.refresh_token ?? refreshToken,
        tokenExpiresAt: tokenExpiresAt(refreshed.expires_in),
      });

      accessToken = refreshed.access_token;

      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: {
          ...credentialFields,
          status: ConnectorStatus.ACTIVE,
          lastSyncError: null,
        },
      });
    }

    const metrics = await client.runSessionsReport({
      accessToken,
      propertyId: connector.externalAccountId,
      since: input.range.since,
      until: input.range.until,
    });

    const payloads = metrics.map((metric) =>
      mapGoogleAnalyticsSessionToDailyMetric({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        metric,
      }),
    );
    if (payloads.length > 0) {
      await prisma.$transaction(
        payloads.map((payload) =>
          prisma.dailyMetric.upsert({
            where: { dedupeHash: payload.dedupeHash },
            update: payload,
            create: payload,
          }),
        ),
      );
    }

    await prisma.connectorAccount.update({
      where: { id: connector.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: ConnectorStatus.ACTIVE,
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        rowsUpdated: metrics.length,
      },
    });

    return { rowsUpserted: metrics.length };
  } catch (caught) {
    const message =
      caught instanceof Error
        ? caught.message
        : "Unknown Google Analytics sync error";
    const status = message.includes("refresh token")
      ? ConnectorStatus.TOKEN_EXPIRED
      : ConnectorStatus.ERROR;

    await prisma.connectorAccount.update({
      where: { id: input.connectorAccountId },
      data: {
        status,
        lastSyncError: message,
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    throw caught;
  }
}
