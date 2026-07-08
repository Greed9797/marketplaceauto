import {
  ConnectorProvider,
  type ConnectorProviderConfig,
  type ConnectorProviderConfigStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  getSecretStore,
  serializeSecretRefs,
  type SecretRefMap,
  type SecretStore,
} from "@/lib/security/secret-store";

import { getProviderDefaults } from "./global-defaults";
import { assertPublicHttpUrl } from "./url-guard";
import type { GoogleAdsConfig } from "./google-ads/oauth";
import type { GoogleAnalyticsConfig } from "./google-analytics/oauth";
import type { MercadoLivreConfig } from "./mercado-livre/oauth";
import { MERCADO_LIVRE_DEFAULT_API_BASE_URL } from "./mercado-livre/oauth";
import type { MetaConfig } from "./meta/oauth";
import type { NuvemshopConfig } from "./nuvemshop/oauth";
import type { ShopeeConfig } from "./shopee/oauth";
import { SHOPEE_DEFAULT_HOST } from "./shopee/oauth";
import { getConnectorDefinition, isManualCommerceProvider } from "./registry";
import type { ShopifyConfig } from "./shopify/oauth";

export type ProviderConfigPublicCredentials = Record<
  string,
  string | null | undefined
>;
export type ProviderConfigSecrets = Record<string, string | null | undefined>;

export type ProviderConfigLike = {
  id?: string;
  workspaceId?: string;
  provider: ConnectorProvider;
  status?: ConnectorProviderConfigStatus | "ACTIVE" | "INACTIVE" | "ERROR";
  redirectUri?: string | null;
  scopes?: string | null;
  apiVersion?: string | null;
  baseUrl?: string | null;
  ordersPath?: string | null;
  displayName?: string | null;
  publicCredentials?: ProviderConfigPublicCredentials | null;
  secretRefs?: SecretRefMap | null;
  lastValidatedAt?: Date | null;
  lastValidationError?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ProviderConfigInput = {
  provider: ConnectorProvider;
  status?: ConnectorProviderConfigStatus | "ACTIVE" | "INACTIVE" | "ERROR";
  redirectUri?: string | null;
  scopes?: string | null;
  apiVersion?: string | null;
  baseUrl?: string | null;
  ordersPath?: string | null;
  displayName?: string | null;
  publicCredentials?: ProviderConfigPublicCredentials;
  secrets?: ProviderConfigSecrets;
  existingSecretRefs?: SecretRefMap;
};

export type PublicProviderConfig = {
  id: string;
  workspaceId: string;
  provider: ConnectorProvider;
  providerName: string;
  status: string;
  redirectUri: string | null;
  scopes: string | null;
  apiVersion: string | null;
  baseUrl: string | null;
  ordersPath: string | null;
  displayName: string | null;
  publicCredentials: ProviderConfigPublicCredentials;
  configuredSecretKeys: string[];
  lastValidatedAt: Date | null;
  lastValidationError: string | null;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function stringRecord(value: unknown): ProviderConfigPublicCredentials {
  return Object.fromEntries(
    Object.entries(jsonRecord(value)).filter(
      (entry): entry is [string, string] => {
        const [, item] = entry;

        return typeof item === "string";
      },
    ),
  );
}

export function parseSecretRefs(value: unknown): SecretRefMap {
  return Object.fromEntries(
    Object.entries(jsonRecord(value)).filter(
      (entry): entry is [string, string] => {
        const [, item] = entry;

        return typeof item === "string" && item.length > 0;
      },
    ),
  );
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function providerName(provider: ConnectorProvider) {
  return getConnectorDefinition(provider).name;
}

function requiredPublicKey(config: ProviderConfigLike, key: string) {
  const value = config.publicCredentials?.[key];
  if (typeof value !== "string" || !hasText(value)) {
    throw new Error(
      `Configuração ${providerName(config.provider)} sem ${key}.`,
    );
  }

  return value.trim();
}

async function requiredSecret(
  config: ProviderConfigLike,
  store: SecretStore,
  key: string,
) {
  const ref = config.secretRefs?.[key];
  if (!ref) {
    throw new Error(
      `Configuração ${providerName(config.provider)} sem segredo ${key}.`,
    );
  }

  return store.getSecret(ref);
}

function requiredConfigText(
  config: ProviderConfigLike,
  key: keyof ProviderConfigLike,
) {
  const value = config[key];
  if (typeof value !== "string" || !hasText(value)) {
    throw new Error(
      `Configuração ${providerName(config.provider)} sem ${String(key)}.`,
    );
  }

  return value.trim();
}

/**
 * Public credential with fallback to the official env-backed default, so the
 * connector works even when the workspace never filled the field.
 */
function resolvePublicKey(config: ProviderConfigLike, key: string) {
  const value = config.publicCredentials?.[key];
  if (typeof value === "string" && hasText(value)) {
    return value.trim();
  }

  const fallback = getProviderDefaults(config.provider)?.publicCredentials[key];
  if (fallback && hasText(fallback)) {
    return fallback.trim();
  }

  throw new Error(`Configuração ${providerName(config.provider)} sem ${key}.`);
}

/** Secret from the store, falling back to the official env-backed default. */
async function resolveSecret(
  config: ProviderConfigLike,
  store: SecretStore,
  key: string,
) {
  const ref = config.secretRefs?.[key];
  if (ref) {
    return store.getSecret(ref);
  }

  const fallback = getProviderDefaults(config.provider)?.secretValues[key];
  if (fallback && hasText(fallback)) {
    return fallback;
  }

  throw new Error(
    `Configuração ${providerName(config.provider)} sem segredo ${key}.`,
  );
}

/** Config text (redirectUri/scopes/apiVersion) with env-default fallback. */
function resolveConfigText(
  config: ProviderConfigLike,
  key: "redirectUri" | "scopes" | "apiVersion",
) {
  const value = config[key];
  if (typeof value === "string" && hasText(value)) {
    return value.trim();
  }

  const fallback = getProviderDefaults(config.provider)?.[key];
  if (fallback && hasText(fallback)) {
    return fallback.trim();
  }

  throw new Error(
    `Configuração ${providerName(config.provider)} sem ${String(key)}.`,
  );
}

export function publicProviderConfig(
  config: ProviderConfigLike,
): PublicProviderConfig {
  return {
    id: config.id ?? "",
    workspaceId: config.workspaceId ?? "",
    provider: config.provider,
    providerName: providerName(config.provider),
    status: config.status ?? "ACTIVE",
    redirectUri: config.redirectUri ?? null,
    scopes: config.scopes ?? null,
    apiVersion: config.apiVersion ?? null,
    baseUrl: config.baseUrl ?? null,
    ordersPath: config.ordersPath ?? null,
    displayName: config.displayName ?? null,
    publicCredentials: stringRecord(config.publicCredentials),
    configuredSecretKeys: Object.keys(config.secretRefs ?? {}).sort(),
    lastValidatedAt: config.lastValidatedAt ?? null,
    lastValidationError: config.lastValidationError ?? null,
  };
}

export function validateProviderConfigInput(input: ProviderConfigInput) {
  const status = input.status ?? "ACTIVE";
  const existingRefs = input.existingSecretRefs ?? {};
  const publicCredentials = input.publicCredentials ?? {};
  const secrets = input.secrets ?? {};
  // Activation validation requires the secret to be supplied by the user or
  // already stored in the DB (existingSecretRefs). Env-backed defaults
  // (process.env) MUST NOT satisfy activation: doing so let an incomplete OAuth
  // config go ACTIVE and then fail silently at sync time. Runtime credential
  // resolution still falls back to env via build*FromProviderConfig — that path
  // is independent of this form-level check.
  const hasSecret = (key: string) =>
    hasText(secrets[key]) || hasText(existingRefs[key]);
  const hasPublic = (key: string) => hasText(publicCredentials[key]);

  if (status !== "ACTIVE") {
    return { success: true as const };
  }

  if (input.provider === ConnectorProvider.META_ADS) {
    // OAuth path only: appId + appSecret required only when redirectUri set.
    // System User mode: skip OAuth credential checks (token lives on the
    // ConnectorAccount, ProviderConfig keeps pixel event IDs / scopes).
    if (hasText(input.redirectUri)) {
      if (!hasPublic("appId")) {
        return {
          success: false as const,
          error:
            "Informe o App ID da Meta para o fluxo OAuth ou remova o Redirect URI.",
        };
      }
      if (!hasSecret("appSecret")) {
        return {
          success: false as const,
          error:
            "Informe o app secret da Meta para o fluxo OAuth ou remova o Redirect URI.",
        };
      }
    }
  }

  if (input.provider === ConnectorProvider.GOOGLE_ADS) {
    if (!hasPublic("clientId")) {
      return {
        success: false as const,
        error: "Informe o client ID do Google Ads.",
      };
    }
    if (!hasSecret("clientSecret")) {
      return {
        success: false as const,
        error: "Informe o client secret do Google Ads.",
      };
    }
    if (!hasSecret("developerToken")) {
      return {
        success: false as const,
        error: "Informe o developer token do Google Ads.",
      };
    }
  }

  if (input.provider === ConnectorProvider.GA4) {
    if (!hasPublic("clientId")) {
      return {
        success: false as const,
        error: "Informe o client ID do Google Analytics.",
      };
    }
    if (!hasSecret("clientSecret")) {
      return {
        success: false as const,
        error: "Informe o client secret do Google Analytics.",
      };
    }
  }

  if (input.provider === ConnectorProvider.SHOPIFY) {
    if (!hasPublic("apiKey")) {
      return {
        success: false as const,
        error: "Informe a API key da Shopify.",
      };
    }
    if (!hasSecret("apiSecret")) {
      return {
        success: false as const,
        error: "Informe o API secret da Shopify.",
      };
    }
  }

  if (input.provider === ConnectorProvider.NUVEMSHOP) {
    if (!hasPublic("clientId")) {
      return {
        success: false as const,
        error: "Informe o client ID da Nuvemshop.",
      };
    }
    if (!hasSecret("clientSecret")) {
      return {
        success: false as const,
        error: "Informe o client secret da Nuvemshop.",
      };
    }
  }

  if (input.provider === ConnectorProvider.MERCADO_LIVRE) {
    if (!hasPublic("clientId")) {
      return {
        success: false as const,
        error: "Informe o client ID do Mercado Livre.",
      };
    }
    if (!hasSecret("clientSecret")) {
      return {
        success: false as const,
        error: "Informe o client secret do Mercado Livre.",
      };
    }
  }

  if (input.provider === ConnectorProvider.SHOPEE) {
    if (!hasPublic("partnerId")) {
      return {
        success: false as const,
        error: "Informe o Partner ID da Shopee.",
      };
    }
    if (!hasSecret("partnerKey")) {
      return {
        success: false as const,
        error: "Informe a Partner Key da Shopee.",
      };
    }
  }

  // SSRF guard for the OAuth marketplace providers too (ML/Shopee). Their
  // optional baseUrl/host override is fetched server-side with the client
  // secret (token exchange) and the access token (sync), so a private/internal
  // host must be rejected at the save boundary — same policy as manual commerce.
  if (
    (input.provider === ConnectorProvider.MERCADO_LIVRE ||
      input.provider === ConnectorProvider.SHOPEE) &&
    input.baseUrl?.trim()
  ) {
    try {
      assertPublicHttpUrl(input.baseUrl.trim());
    } catch (error: unknown) {
      return {
        success: false as const,
        error:
          error instanceof Error
            ? error.message
            : "URL da API inválida ou não permitida.",
      };
    }
  }

  if (isManualCommerceProvider(input.provider)) {
    // SSRF guard at the save boundary: a user-supplied baseUrl must not point at
    // a private/loopback/metadata/internal host. Runtime fetch is also guarded,
    // but blocking here gives an actionable error and stops poisoned configs from
    // ever being persisted.
    const baseUrlValue = input.baseUrl?.trim();
    if (baseUrlValue) {
      try {
        assertPublicHttpUrl(baseUrlValue);
      } catch (error: unknown) {
        return {
          success: false as const,
          error:
            error instanceof Error
              ? error.message
              : "URL da API inválida ou não permitida.",
        };
      }
    }
    // WBuy and Loja Integrada have built-in default base URLs, so the field is
    // optional for them.
    if (
      input.provider !== ConnectorProvider.WBUY &&
      input.provider !== ConnectorProvider.LOJA_INTEGRADA &&
      !hasText(input.baseUrl)
    ) {
      return {
        success: false as const,
        error:
          input.provider === ConnectorProvider.GOOGLE_SHEETS
            ? "Informe a URL da planilha Google."
            : "Informe a URL da API da loja.",
      };
    }
    if (input.provider === ConnectorProvider.GOOGLE_SHEETS) {
      return { success: true as const };
    }
    if (input.provider === ConnectorProvider.LOJA_INTEGRADA) {
      // Loja Integrada needs BOTH keys: chave_api (apiKey, per-store) and
      // chave_aplicacao (apiSecret, per-integrator).
      if (!hasSecret("apiKey")) {
        return {
          success: false as const,
          error: "Informe a Chave de API (chave_api) da Loja Integrada.",
        };
      }
      if (!hasSecret("apiSecret")) {
        return {
          success: false as const,
          error:
            "Informe a Chave de Aplicação (chave_aplicacao) da Loja Integrada.",
        };
      }
      return { success: true as const };
    }
    if (input.provider === ConnectorProvider.LEVANE) {
      // Levane (Supabase): anon key unlocks REST; apiUser/apiPassword are the
      // store login exchanged for a token at sync time.
      if (!hasSecret("apiKey")) {
        return {
          success: false as const,
          error: "Informe a chave anon (apiKey) do Supabase do Levane.",
        };
      }
      if (!hasSecret("apiUser") || !hasSecret("apiPassword")) {
        return {
          success: false as const,
          error: "Informe o e-mail e a senha de login do Levane.",
        };
      }
      return { success: true as const };
    }
    if (
      !hasSecret("apiKey") &&
      !hasSecret("apiSecret") &&
      !hasSecret("apiUser") &&
      !hasSecret("apiPassword")
    ) {
      return {
        success: false as const,
        error: "Informe pelo menos uma credencial da API.",
      };
    }
  }

  return { success: true as const };
}

function cleanPublicCredentials(
  credentials: ProviderConfigPublicCredentials | undefined,
) {
  return Object.fromEntries(
    Object.entries(credentials ?? {})
      .map(([key, value]) => [key, value?.trim() ?? ""] as const)
      .filter(([, value]) => value.length > 0),
  );
}

async function saveSecrets(input: {
  provider: ConnectorProvider;
  workspaceId: string;
  secrets: ProviderConfigSecrets;
  existingRefs: SecretRefMap;
  store: SecretStore;
}) {
  const refs: SecretRefMap = { ...input.existingRefs };

  for (const [key, rawValue] of Object.entries(input.secrets)) {
    const value = rawValue?.trim();
    if (!value) {
      continue;
    }

    const name = `w3ads:${input.workspaceId}:${input.provider}:${key}`;
    if (refs[key]) {
      await input.store.updateSecret(refs[key], { name, value });
    } else {
      refs[key] = await input.store.createSecret({ name, value });
    }
  }

  return refs;
}

export async function upsertConnectorProviderConfig(input: {
  workspaceId: string;
  actorUserId: string;
  config: ProviderConfigInput;
  store?: SecretStore;
}) {
  const existing = await prisma.connectorProviderConfig.findUnique({
    where: {
      workspaceId_provider: {
        workspaceId: input.workspaceId,
        provider: input.config.provider,
      },
    },
  });
  const existingRefs = parseSecretRefs(existing?.secretRefs);
  const validation = validateProviderConfigInput({
    ...input.config,
    existingSecretRefs: existingRefs,
  });

  if (!validation.success) {
    throw new Error(validation.error);
  }

  const store = input.store ?? getSecretStore();
  const secretRefs = await saveSecrets({
    provider: input.config.provider,
    workspaceId: input.workspaceId,
    secrets: input.config.secrets ?? {},
    existingRefs,
    store,
  });
  const publicCredentials = cleanPublicCredentials(
    input.config.publicCredentials,
  );
  const status = input.config.status ?? "ACTIVE";

  return prisma.connectorProviderConfig.upsert({
    where: {
      workspaceId_provider: {
        workspaceId: input.workspaceId,
        provider: input.config.provider,
      },
    },
    update: {
      status,
      redirectUri: input.config.redirectUri?.trim() || null,
      scopes: input.config.scopes?.trim() || null,
      apiVersion: input.config.apiVersion?.trim() || null,
      baseUrl: input.config.baseUrl?.trim() || null,
      ordersPath: input.config.ordersPath?.trim() || null,
      displayName: input.config.displayName?.trim() || null,
      publicCredentials,
      secretRefs,
      lastValidationError: null,
    },
    create: {
      workspaceId: input.workspaceId,
      provider: input.config.provider,
      status,
      redirectUri: input.config.redirectUri?.trim() || null,
      scopes: input.config.scopes?.trim() || null,
      apiVersion: input.config.apiVersion?.trim() || null,
      baseUrl: input.config.baseUrl?.trim() || null,
      ordersPath: input.config.ordersPath?.trim() || null,
      displayName: input.config.displayName?.trim() || null,
      publicCredentials,
      secretRefs,
    },
  });
}

function normalizeConfig(config: ConnectorProviderConfig): ProviderConfigLike {
  return {
    ...config,
    publicCredentials: stringRecord(config.publicCredentials),
    secretRefs: parseSecretRefs(config.secretRefs),
  };
}

export async function getProviderConfig(input: {
  workspaceId: string;
  provider: ConnectorProvider;
}) {
  const config = await prisma.connectorProviderConfig.findUnique({
    where: {
      workspaceId_provider: {
        workspaceId: input.workspaceId,
        provider: input.provider,
      },
    },
  });

  return config ? normalizeConfig(config) : null;
}

export async function getActiveProviderConfig(input: {
  workspaceId: string;
  provider: ConnectorProvider;
}) {
  const config = await getProviderConfig(input);

  return config?.status === "ACTIVE" ? config : null;
}

export async function listPublicProviderConfigs(workspaceId: string) {
  const configs = await prisma.connectorProviderConfig.findMany({
    where: { workspaceId },
    orderBy: [{ provider: "asc" }],
  });

  return configs.map((config) => publicProviderConfig(normalizeConfig(config)));
}

export async function buildMetaConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<MetaConfig> {
  return {
    appId: requiredPublicKey(config, "appId"),
    appSecret: await requiredSecret(config, store, "appSecret"),
    redirectUri: requiredConfigText(config, "redirectUri"),
    apiVersion: config.apiVersion?.trim() || "v25.0",
  };
}

export async function buildGoogleAdsConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<GoogleAdsConfig> {
  const defaults = getProviderDefaults(config.provider);
  return {
    clientId: resolvePublicKey(config, "clientId"),
    clientSecret: await resolveSecret(config, store, "clientSecret"),
    developerToken: await resolveSecret(config, store, "developerToken"),
    redirectUri: resolveConfigText(config, "redirectUri"),
    apiVersion: config.apiVersion?.trim() || defaults?.apiVersion || "v24",
    loginCustomerId:
      config.publicCredentials?.loginCustomerId ??
      defaults?.publicCredentials.loginCustomerId ??
      undefined,
  };
}

export async function buildGoogleAnalyticsConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<GoogleAnalyticsConfig> {
  return {
    clientId: resolvePublicKey(config, "clientId"),
    clientSecret: await resolveSecret(config, store, "clientSecret"),
    redirectUri: resolveConfigText(config, "redirectUri"),
  };
}

export async function buildShopifyConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<ShopifyConfig> {
  return {
    apiKey: requiredPublicKey(config, "apiKey"),
    apiSecret: await requiredSecret(config, store, "apiSecret"),
    redirectUri: requiredConfigText(config, "redirectUri"),
    scopes:
      config.scopes?.trim() ||
      // read_inventory powers the catalog stock pull (ProductVariant.inventoryQuantity);
      // read_products covers productType (category). Connections authorized before
      // read_inventory was added fall back to category-only in listProducts.
      "read_orders,read_all_orders,read_products,read_inventory,read_customers,read_analytics",
    apiVersion: config.apiVersion?.trim() || "2026-04",
  };
}

export async function buildNuvemshopConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<NuvemshopConfig> {
  return {
    clientId: requiredPublicKey(config, "clientId"),
    clientSecret: await requiredSecret(config, store, "clientSecret"),
    redirectUri: requiredConfigText(config, "redirectUri"),
    apiBaseUrl: config.baseUrl?.trim() || "https://api.nuvemshop.com.br/v1",
  };
}

export async function buildMercadoLivreConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<MercadoLivreConfig> {
  const baseUrl = config.baseUrl?.trim();
  if (baseUrl) {
    // Defense in depth: reject a poisoned baseUrl even for configs persisted
    // before the validate-time guard (it is fetched with the client secret).
    assertPublicHttpUrl(baseUrl);
  }
  return {
    clientId: requiredPublicKey(config, "clientId"),
    clientSecret: await requiredSecret(config, store, "clientSecret"),
    redirectUri: requiredConfigText(config, "redirectUri"),
    apiBaseUrl: baseUrl || MERCADO_LIVRE_DEFAULT_API_BASE_URL,
  };
}

export async function buildShopeeConfigFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
): Promise<ShopeeConfig> {
  const partnerIdText = requiredPublicKey(config, "partnerId");
  const partnerId = Number(partnerIdText);
  if (!Number.isFinite(partnerId) || partnerId <= 0) {
    throw new Error(
      `Configuração ${providerName(config.provider)} com partnerId inválido.`,
    );
  }

  const host = config.baseUrl?.trim();
  if (host) {
    // Defense in depth: the shop host is signed and called with the access
    // token, so a private/internal override must be rejected at build time too.
    assertPublicHttpUrl(host);
  }
  return {
    partnerId,
    partnerKey: await requiredSecret(config, store, "partnerKey"),
    redirectUri: requiredConfigText(config, "redirectUri"),
    host: host || SHOPEE_DEFAULT_HOST,
  };
}

export async function publicManualCredentialsFromProviderConfig(
  config: ProviderConfigLike,
  store: SecretStore = getSecretStore(),
) {
  const secretRefs = parseSecretRefs(config.secretRefs);
  const credentials: Record<string, string> = {};

  for (const key of ["apiKey", "apiSecret", "apiUser", "apiPassword"]) {
    if (secretRefs[key]) {
      credentials[key] = await store.getSecret(secretRefs[key]);
    }
  }
  if (
    !credentials.apiKey &&
    typeof config.publicCredentials?.apiKey === "string"
  ) {
    credentials.apiKey = config.publicCredentials.apiKey;
  }

  return {
    ...credentials,
    baseUrl:
      !config.baseUrl?.trim() && config.provider === ConnectorProvider.WBUY
        ? "https://sistema.sistemawbuy.com.br/api/v1"
        : !config.baseUrl?.trim() &&
            config.provider === ConnectorProvider.LOJA_INTEGRADA
          ? "https://api.awsli.com.br/v1"
          : requiredConfigText(config, "baseUrl"),
    ordersPath:
      config.provider === ConnectorProvider.WBUY &&
      config.ordersPath?.trim().replace(/\/+$/, "").toLowerCase() === "/orders"
        ? "/order"
        : config.ordersPath?.trim() ||
          (config.provider === ConnectorProvider.GOOGLE_SHEETS
            ? ""
            : config.provider === ConnectorProvider.WBUY
              ? "/order"
              : config.provider === ConnectorProvider.ISET
                ? "/pedidos"
                : config.provider === ConnectorProvider.MAGAZORD
                  ? "/api/v2/site/pedido"
                  : config.provider === ConnectorProvider.LOJA_INTEGRADA
                    ? "/pedido/search/"
                    : "/orders"),
  };
}

export function providerConfigToJson(config: ProviderConfigInput) {
  return {
    provider: config.provider,
    status: config.status ?? "ACTIVE",
    redirectUri: config.redirectUri ?? null,
    scopes: config.scopes ?? null,
    apiVersion: config.apiVersion ?? null,
    baseUrl: config.baseUrl ?? null,
    ordersPath: config.ordersPath ?? null,
    displayName: config.displayName ?? null,
    publicCredentials: cleanPublicCredentials(config.publicCredentials),
    secretRefs: serializeSecretRefs(config.existingSecretRefs ?? {}),
  } satisfies Prisma.InputJsonObject;
}
