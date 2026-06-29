"use server";

import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import {
  encryptConnectorCredentials,
  stableExternalAccountId,
} from "@/lib/connectors/credentials";
import { buildConnectorBackfillEvent } from "@/lib/connectors/backfill";
import { getProviderDefaults } from "@/lib/connectors/global-defaults";
import { isInngestConfigured } from "@/lib/connectors/inngest-config";
import { syncMetaDailyMetrics } from "@/lib/connectors/meta/sync";
import { computeForegroundRange } from "@/lib/connectors/sync-range";
import { prisma } from "@/lib/db/prisma";
import { inngest } from "@/lib/jobs/inngest-client";

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAdAccountId(raw: string): string {
  const clean = raw.replace(/^act_/i, "").trim();
  if (!/^\d+$/.test(clean)) {
    throw new Error("invalid-ad-account-id");
  }
  return clean;
}

export async function connectMetaSystemUserAction(
  formData: FormData,
): Promise<void> {
  const context = await getCurrentUserContext();
  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    redirect("/connectors?provider=meta_ads&error=forbidden");
  }

  const accessToken =
    getString(formData, "accessToken") ||
    getProviderDefaults(ConnectorProvider.META_ADS)?.secretValues.accessToken ||
    "";
  const adAccountRaw = getString(formData, "adAccountId");
  const accountLabel =
    getString(formData, "accountName") || `act_${adAccountRaw}`;

  if (!accessToken || !adAccountRaw) {
    redirect("/connectors?provider=meta_ads&error=invalid-meta-system-form");
  }

  let adAccountId: string;
  try {
    adAccountId = normalizeAdAccountId(adAccountRaw);
  } catch {
    redirect("/connectors?provider=meta_ads&error=invalid-ad-account-id");
  }

  const credentials = encryptConnectorCredentials({
    accessToken,
    adAccountId,
  });
  const externalAccountId = stableExternalAccountId(
    ConnectorProvider.META_ADS,
    `system-user:${adAccountId}`,
  );

  const connectorAccount = await prisma.connectorAccount.upsert({
    where: {
      workspaceId_provider_externalAccountId: {
        workspaceId: context.currentWorkspace.id,
        provider: ConnectorProvider.META_ADS,
        externalAccountId,
      },
    },
    update: {
      accountName: accountLabel,
      status: ConnectorStatus.ACTIVE,
      accessTokenCiphertext: credentials.ciphertext,
      tokenIv: credentials.iv,
      tokenAuthTag: credentials.authTag,
      tokenKeyVersion: credentials.keyVersion,
      credentialSecretId: null,
      tokenExpiresAt: null,
      lastSyncError: null,
      metadata: {
        credentialMode: "system-user",
        adAccountId,
      },
    },
    create: {
      workspaceId: context.currentWorkspace.id,
      provider: ConnectorProvider.META_ADS,
      externalAccountId,
      accountName: accountLabel,
      status: ConnectorStatus.ACTIVE,
      accessTokenCiphertext: credentials.ciphertext,
      tokenIv: credentials.iv,
      tokenAuthTag: credentials.authTag,
      tokenKeyVersion: credentials.keyVersion,
      credentialSecretId: null,
      tokenExpiresAt: null,
      metadata: {
        credentialMode: "system-user",
        adAccountId,
      },
    },
  });

  const inngestActive = isInngestConfigured();
  let inlineSyncRan = false;
  let inlineSyncError: string | null = null;

  if (inngestActive) {
    try {
      await inngest.send(
        buildConnectorBackfillEvent({
          provider: ConnectorProvider.META_ADS,
          connectorAccountId: connectorAccount.id,
        }),
      );
    } catch (err) {
      inlineSyncError =
        err instanceof Error ? err.message : "inngest_send_failed";
    }
  } else {
    // Align with the rest of the codebase: current UTC month → today instead
    // of a hand-rolled 30d window. Avoids a one-day blind spot on connect day.
    const range = computeForegroundRange();

    try {
      await syncMetaDailyMetrics({
        connectorAccountId: connectorAccount.id,
        range,
        syncType: "BACKFILL",
      });
      inlineSyncRan = true;
    } catch (err) {
      inlineSyncError =
        err instanceof Error ? err.message : "inline_sync_failed";
    }
  }

  await logAudit({
    action: "connector.meta.connect",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "connector_account",
    resourceId: connectorAccount.id,
    metadata: {
      provider: ConnectorProvider.META_ADS,
      credentialMode: "system-user",
      backfillQueued: inngestActive,
      inlineSyncRan,
      inlineSyncError,
    },
  });

  redirect(`/connectors?provider=meta_ads&connected=meta_ads_system_user`);
}
