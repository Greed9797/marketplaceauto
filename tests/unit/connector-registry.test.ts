import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  CONNECTOR_PROVIDER_DEFINITIONS,
  manualCommerceProviders,
  oauthCommerceProviders,
  selectableAnalyticsProviders,
  selectableAdsProviders,
} from "@/lib/connectors/registry";

describe("connector registry", () => {
  it("declares every MVP provider with a connection mode", () => {
    expect(Object.keys(CONNECTOR_PROVIDER_DEFINITIONS).sort()).toEqual(
      [
        ConnectorProvider.GOOGLE_ADS,
        ConnectorProvider.GA4,
        ConnectorProvider.GOOGLE_SHEETS,
        ConnectorProvider.ISET,
        ConnectorProvider.MAGAZORD,
        ConnectorProvider.META_ADS,
        ConnectorProvider.NUVEMSHOP,
        ConnectorProvider.SHOPIFY,
        ConnectorProvider.TRAY,
        ConnectorProvider.WBUY,
        ConnectorProvider.LOJA_INTEGRADA,
        ConnectorProvider.MERCADO_LIVRE,
        ConnectorProvider.SHOPEE,
        ConnectorProvider.SHOPEE_ADS,
        ConnectorProvider.MERCADO_LIVRE_ADS,
      ].sort(),
    );
  });

  it("separates selectable ad accounts from ecommerce stores", () => {
    expect(selectableAdsProviders).toEqual([
      ConnectorProvider.META_ADS,
      ConnectorProvider.GOOGLE_ADS,
    ]);
    expect(selectableAnalyticsProviders).toEqual([ConnectorProvider.GA4]);
    expect(oauthCommerceProviders).toEqual([
      ConnectorProvider.SHOPIFY,
      ConnectorProvider.NUVEMSHOP,
      ConnectorProvider.MERCADO_LIVRE,
      ConnectorProvider.SHOPEE,
    ]);
    expect(manualCommerceProviders).toEqual([
      ConnectorProvider.ISET,
      ConnectorProvider.TRAY,
      ConnectorProvider.WBUY,
      ConnectorProvider.MAGAZORD,
      ConnectorProvider.GOOGLE_SHEETS,
      ConnectorProvider.LOJA_INTEGRADA,
    ]);
  });
});
