import { createHash } from "node:crypto";
import { ConnectorProvider, ConnectorStatus, SyncStatus } from "@prisma/client";

import { connectorAccessTokenFromAccount } from "@/lib/connectors/credentials";
import {
  buildMetaConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { prisma } from "@/lib/db/prisma";
import {
  buildSyncJobCreateInput,
  type ProductionSyncType,
} from "@/lib/jobs/sync-operations";

import {
  MetaApiError,
  MetaMarketingClient,
  type MetaCampaignInsight,
  type MetaPixelEventIds,
} from "./client";
import { META_DEFAULT_API_VERSION } from "./oauth";

export type MetaSyncRange = {
  since: string;
  until: string;
};

function asDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function asBigInt(value: string | null) {
  return value ? BigInt(value) : null;
}

function dedupeHash(input: {
  workspaceId: string;
  connectorAccountId: string;
  date: string;
  source: ConnectorProvider;
  campaignId: string | null;
}) {
  return createHash("sha256")
    .update(
      [
        input.workspaceId,
        input.connectorAccountId,
        input.date,
        input.source,
        input.campaignId ?? "",
      ].join(":"),
    )
    .digest("hex");
}

export function mapMetaInsightToDailyMetric(input: {
  workspaceId: string;
  connectorAccountId: string;
  insight: MetaCampaignInsight;
}) {
  const { insight } = input;

  return {
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    date: asDateOnly(insight.dateStart),
    source: ConnectorProvider.META_ADS,
    campaignId: insight.campaignId,
    campaignName: insight.campaignName,
    campaignStatus: insight.campaignStatus,
    campaignObjective: insight.campaignObjective,
    adsetId: null,
    adsetName: null,
    adId: null,
    spend: insight.spend,
    impressions: asBigInt(insight.impressions),
    clicks: asBigInt(insight.clicks),
    addToCart: asBigInt(insight.addToCart),
    conversions: insight.conversions,
    conversionsValue: insight.conversionsValue,
    leads: asBigInt(insight.leads),
    scheduledEvents: asBigInt(insight.scheduledEvents),
    sessions: null,
    orders: null,
    revenue: null,
    dedupeHash: dedupeHash({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      date: insight.dateStart,
      source: ConnectorProvider.META_ADS,
      campaignId: insight.campaignId,
    }),
  };
}

function isMetaTokenExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (!message) return false;
  if (message.includes('"code":190')) return true;
  if (message.toLowerCase().includes("token expired")) return true;
  if (message.toLowerCase().includes("oauth")) {
    return message.includes("190");
  }
  return false;
}

function readPixelEventIds(
  publicCredentials: Record<string, string> | null | undefined,
): MetaPixelEventIds {
  return {
    leadEventId: publicCredentials?.leadEventId?.trim() || null,
    scheduledEventId: publicCredentials?.scheduledEventId?.trim() || null,
  };
}

function isSystemUserConnector(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const mode = (metadata as Record<string, unknown>).credentialMode;
  return mode === "system-user";
}

function readMetadataAdAccountId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).adAccountId;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

export async function syncMetaDailyMetrics(input: {
  connectorAccountId: string;
  range: MetaSyncRange;
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
      provider: ConnectorProvider.META_ADS,
    });
    const systemUser = isSystemUserConnector(connector.metadata);

    if (!providerConfig && !systemUser) {
      throw new Error("Meta provider config is missing");
    }

    const accessToken = await connectorAccessTokenFromAccount(connector);
    const apiVersion =
      providerConfig?.apiVersion?.trim() || META_DEFAULT_API_VERSION;
    const client = providerConfig
      ? new MetaMarketingClient({
          config: await buildMetaConfigFromProviderConfig(providerConfig),
        })
      : new MetaMarketingClient({
          config: {
            appId: "system-user",
            appSecret: "system-user",
            redirectUri: "system-user",
            apiVersion,
          },
        });
    const pixelEventIds = readPixelEventIds(
      providerConfig?.publicCredentials as Record<string, string> | undefined,
    );

    const adAccountId = systemUser
      ? (readMetadataAdAccountId(connector.metadata) ??
        connector.externalAccountId)
      : connector.externalAccountId;

    const { insights, truncated } = await client.getCampaignInsights({
      accessToken,
      adAccountId,
      since: input.range.since,
      until: input.range.until,
      pixelEventIds,
    });

    // Batch all per-day upserts into a single transaction round-trip. With
    // 500+ rows per backfill batch this drops ~2.5s of sequential DB latency.
    const metrics = insights.map((insight) =>
      mapMetaInsightToDailyMetric({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        insight,
      }),
    );
    if (metrics.length > 0) {
      await prisma.$transaction(
        metrics.map((metric) =>
          prisma.dailyMetric.upsert({
            where: { dedupeHash: metric.dedupeHash },
            update: metric,
            create: metric,
          }),
        ),
      );
    }

    await prisma.connectorAccount.update({
      where: { id: connector.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: truncated
          ? "Sincronizando histórico em segundo plano — aguarde os próximos ciclos."
          : null,
        status: ConnectorStatus.ACTIVE,
        // historicalSyncedAt / historicalBackfillUntil are managed by the
        // orchestrator (see sync-orchestrator.ts) to keep this layer
        // agnostic of the foreground/backfill split.
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        rowsUpdated: insights.length,
      },
    });

    return { rowsUpserted: insights.length };
  } catch (caught) {
    let message =
      caught instanceof Error ? caught.message : "Unknown Meta sync error";
    if (
      caught instanceof MetaApiError &&
      caught.body &&
      !message.includes(":")
    ) {
      message = `${message} | body: ${caught.body.slice(0, 200)}`;
    }
    const tokenExpired = isMetaTokenExpiredError(caught);

    await prisma.connectorAccount.update({
      where: { id: input.connectorAccountId },
      data: {
        status: tokenExpired
          ? ConnectorStatus.TOKEN_EXPIRED
          : ConnectorStatus.ERROR,
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
