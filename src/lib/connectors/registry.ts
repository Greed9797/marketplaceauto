import { ConnectorProvider } from "@prisma/client";

export type ConnectorConnectionMode = "oauth" | "manual";
export type ConnectorCategory = "ads" | "analytics" | "commerce";

export type ConnectorProviderDefinition = {
  provider: ConnectorProvider;
  name: string;
  category: ConnectorCategory;
  connectionMode: ConnectorConnectionMode;
  accountUnitLabel: string;
  supportsSelection: boolean;
  supportsOrders: boolean;
  supportsAdMetrics: boolean;
};

export const CONNECTOR_PROVIDER_DEFINITIONS: Partial<
  Record<ConnectorProvider, ConnectorProviderDefinition>
> = {
  [ConnectorProvider.META_ADS]: {
    provider: ConnectorProvider.META_ADS,
    name: "Meta Ads",
    category: "ads",
    connectionMode: "oauth",
    accountUnitLabel: "Conta de anuncio",
    supportsSelection: true,
    supportsOrders: false,
    supportsAdMetrics: true,
  },
  [ConnectorProvider.GOOGLE_ADS]: {
    provider: ConnectorProvider.GOOGLE_ADS,
    name: "Google Ads",
    category: "ads",
    connectionMode: "oauth",
    accountUnitLabel: "Conta de cliente",
    supportsSelection: true,
    supportsOrders: false,
    supportsAdMetrics: true,
  },
  [ConnectorProvider.GA4]: {
    provider: ConnectorProvider.GA4,
    name: "Google Analytics",
    category: "analytics",
    connectionMode: "oauth",
    accountUnitLabel: "Propriedade GA4",
    supportsSelection: true,
    supportsOrders: false,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.SHOPIFY]: {
    provider: ConnectorProvider.SHOPIFY,
    name: "Shopify",
    category: "commerce",
    connectionMode: "oauth",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.NUVEMSHOP]: {
    provider: ConnectorProvider.NUVEMSHOP,
    name: "Nuvemshop",
    category: "commerce",
    connectionMode: "oauth",
    accountUnitLabel: "Loja",
    supportsSelection: true,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.ISET]: {
    provider: ConnectorProvider.ISET,
    name: "iSet",
    category: "commerce",
    connectionMode: "manual",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.TRAY]: {
    provider: ConnectorProvider.TRAY,
    name: "Tray",
    category: "commerce",
    connectionMode: "manual",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.WBUY]: {
    provider: ConnectorProvider.WBUY,
    name: "WBuy",
    category: "commerce",
    connectionMode: "manual",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.MAGAZORD]: {
    provider: ConnectorProvider.MAGAZORD,
    name: "Magazord",
    category: "commerce",
    connectionMode: "manual",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.GOOGLE_SHEETS]: {
    provider: ConnectorProvider.GOOGLE_SHEETS,
    name: "Google Sheets / WhatsApp",
    category: "commerce",
    connectionMode: "manual",
    accountUnitLabel: "Planilha",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.LOJA_INTEGRADA]: {
    provider: ConnectorProvider.LOJA_INTEGRADA,
    name: "Loja Integrada",
    category: "commerce",
    connectionMode: "manual",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.MERCADO_LIVRE]: {
    provider: ConnectorProvider.MERCADO_LIVRE,
    name: "Mercado Livre",
    category: "commerce",
    connectionMode: "oauth",
    accountUnitLabel: "Conta",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.SHOPEE]: {
    provider: ConnectorProvider.SHOPEE,
    name: "Shopee",
    category: "commerce",
    connectionMode: "oauth",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: true,
    supportsAdMetrics: false,
  },
  [ConnectorProvider.SHOPEE_ADS]: {
    provider: ConnectorProvider.SHOPEE_ADS,
    name: "Shopee Ads",
    category: "ads",
    connectionMode: "oauth",
    accountUnitLabel: "Loja",
    supportsSelection: false,
    supportsOrders: false,
    supportsAdMetrics: true,
  },
  [ConnectorProvider.MERCADO_LIVRE_ADS]: {
    provider: ConnectorProvider.MERCADO_LIVRE_ADS,
    name: "Mercado Livre Ads",
    category: "ads",
    connectionMode: "oauth",
    accountUnitLabel: "Conta",
    supportsSelection: false,
    supportsOrders: false,
    supportsAdMetrics: true,
  },
};

export const selectableAdsProviders = [
  ConnectorProvider.META_ADS,
  ConnectorProvider.GOOGLE_ADS,
] as const;

export const selectableAnalyticsProviders = [ConnectorProvider.GA4] as const;

export const oauthCommerceProviders = [
  ConnectorProvider.SHOPIFY,
  ConnectorProvider.NUVEMSHOP,
  ConnectorProvider.MERCADO_LIVRE,
  ConnectorProvider.SHOPEE,
] as const;

// Marketplace-native ad sources. Single-account (shop/seller-scoped), so they
// reuse the parent marketplace OAuth token rather than an account-selection step.
export const oauthAdsProviders = [
  ConnectorProvider.SHOPEE_ADS,
  ConnectorProvider.MERCADO_LIVRE_ADS,
] as const;

export const manualCommerceProviders = [
  ConnectorProvider.ISET,
  ConnectorProvider.TRAY,
  ConnectorProvider.WBUY,
  ConnectorProvider.MAGAZORD,
  ConnectorProvider.GOOGLE_SHEETS,
  ConnectorProvider.LOJA_INTEGRADA,
] as const;

export function getConnectorDefinition(provider: ConnectorProvider) {
  const definition = CONNECTOR_PROVIDER_DEFINITIONS[provider];

  if (!definition) {
    throw new Error(`Unsupported connector provider: ${provider}`);
  }

  return definition;
}

export function isManualCommerceProvider(provider: ConnectorProvider) {
  return manualCommerceProviders.includes(
    provider as (typeof manualCommerceProviders)[number],
  );
}

export function isOAuthCommerceProvider(provider: ConnectorProvider) {
  return oauthCommerceProviders.includes(
    provider as (typeof oauthCommerceProviders)[number],
  );
}

export function isOAuthAdsProvider(provider: ConnectorProvider) {
  return oauthAdsProviders.includes(
    provider as (typeof oauthAdsProviders)[number],
  );
}
