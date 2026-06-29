"use server";

import { ConnectorProvider } from "@prisma/client";
import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { resolveAppOrigin } from "@/lib/auth/origin";
import {
  assertCanManageProviderConfigs,
  canOperateWorkspaceConnectors,
} from "@/lib/auth/platform-permissions";
import {
  getProviderConfig,
  upsertConnectorProviderConfig,
  type ProviderConfigInput,
} from "@/lib/connectors/provider-config";
import { normalizeShopDomain } from "@/lib/connectors/shopify/oauth";

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function connectShopifyAction(formData: FormData): Promise<void> {
  const context = await getCurrentUserContext();

  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    redirect("/connectors?provider=shopify&error=forbidden");
  }
  assertCanManageProviderConfigs(context.user);

  // Form posts both display-friendly names (clientId/clientSecret) and the
  // canonical Shopify names (apiKey/apiSecret). Prefer canonical, fall back.
  const apiKey =
    getString(formData, "apiKey") || getString(formData, "clientId");
  const apiSecret =
    getString(formData, "apiSecret") || getString(formData, "clientSecret");
  const shopRaw = getString(formData, "shop");

  if (!apiKey || !apiSecret || !shopRaw) {
    redirect("/connectors?provider=shopify&error=invalid-shopify-form");
  }

  let shop: string;
  try {
    shop = normalizeShopDomain(shopRaw);
  } catch {
    redirect("/connectors?provider=shopify&error=invalid-shop");
  }

  const origin = await resolveAppOrigin();
  const existing = await getProviderConfig({
    workspaceId: context.currentWorkspace.id,
    provider: ConnectorProvider.SHOPIFY,
  });
  const redirectUri =
    existing?.redirectUri?.trim() ||
    `${origin}/api/connectors/shopify/callback`;
  const apiVersion = existing?.apiVersion?.trim() || "2026-04";

  const config: ProviderConfigInput = {
    provider: ConnectorProvider.SHOPIFY,
    status: "ACTIVE",
    redirectUri,
    scopes: existing?.scopes ?? null,
    apiVersion,
    baseUrl: null,
    ordersPath: null,
    displayName: existing?.displayName ?? null,
    publicCredentials: { apiKey },
    secrets: { apiSecret },
  };

  try {
    await upsertConnectorProviderConfig({
      workspaceId: context.currentWorkspace.id,
      actorUserId: context.user.id,
      config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "save_failed";
    redirect(
      `/connectors?provider=shopify&error=${encodeURIComponent(message)}`,
    );
  }

  await logAudit({
    action: "connector.provider_config.update",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "connector_provider_config",
    resourceId: ConnectorProvider.SHOPIFY,
    metadata: {
      provider: ConnectorProvider.SHOPIFY,
      source: "connect-dialog",
    },
  });

  redirect(`/api/connectors/shopify/connect?shop=${encodeURIComponent(shop)}`);
}
