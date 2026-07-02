import { describe, expect, it } from "vitest";
import { ConnectorProvider } from "@prisma/client";

import {
  buildDashboardSnapshot,
  calculateDeltaPercent,
  calculateRatioPercent,
  calculateRoas,
  isApprovedOrderStatus,
} from "@/lib/metrics/aggregator";
import { getDashboardPeriod } from "@/lib/metrics/period";

describe("dashboard aggregator", () => {
  it("calculates ROAS and previous-period deltas", () => {
    expect(calculateRoas(1000, 250)).toBe(4);
    expect(calculateRoas(1000, 0)).toBe(0);
    expect(calculateRatioPercent(25, 100)).toBe(25);
    expect(calculateRatioPercent(25, 0)).toBe(0);
    expect(calculateDeltaPercent(150, 100)).toBe(50);
    expect(calculateDeltaPercent(0, 0)).toBe(0);
    expect(isApprovedOrderStatus("pago")).toBe(true);
    expect(isApprovedOrderStatus("paid")).toBe(true);
    expect(isApprovedOrderStatus("completed")).toBe(true);
    expect(isApprovedOrderStatus("cancelado")).toBe(false);
    expect(isApprovedOrderStatus("refunded")).toBe(false);
    expect(isApprovedOrderStatus("pending")).toBe(false);
    expect(isApprovedOrderStatus("authorized")).toBe(false);
    expect(isApprovedOrderStatus("em separacao")).toBe(false);
  });

  it("builds KPI totals, line series, approved orders, state breakdowns and top campaigns", () => {
    const period = getDashboardPeriod(
      { period: "7d" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [
        {
          connectorAccountId: "shopify-1",
          platform: ConnectorProvider.SHOPIFY,
          orderTotal: "200.00",
          itemsCount: 2,
          status: "pago",
          shippingState: "SP",
          utmSource: "google",
          utmMedium: "organic",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
        {
          connectorAccountId: "nuvemshop-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "300.00",
          itemsCount: 1,
          status: "aprovado",
          shippingState: "RJ",
          utmSource: "meta",
          utmMedium: "cpc",
          placedAt: new Date("2026-05-12T10:00:00.000Z"),
        },
        {
          connectorAccountId: "shopify-1",
          platform: ConnectorProvider.SHOPIFY,
          orderTotal: "100.00",
          itemsCount: 1,
          status: "cancelado",
          shippingState: "SP",
          utmSource: "google",
          utmMedium: "organic",
          placedAt: new Date("2026-05-04T10:00:00.000Z"),
        },
        {
          connectorAccountId: "shopify-1",
          platform: ConnectorProvider.SHOPIFY,
          orderTotal: "999.00",
          itemsCount: 1,
          status: "refunded",
          shippingState: "SC",
          utmSource: "email",
          utmMedium: "crm",
          placedAt: new Date("2026-05-12T11:00:00.000Z"),
        },
      ],
      metrics: [
        {
          date: new Date("2026-05-10T00:00:00.000Z"),
          connectorAccountId: "meta-1",
          source: ConnectorProvider.META_ADS,
          campaignId: "c1",
          campaignName: "Marca",
          campaignStatus: "ACTIVE",
          campaignObjective: "OUTCOME_SALES",
          spend: "100.00",
          impressions: BigInt(1000),
          clicks: BigInt(100),
          sessions: BigInt(80),
          conversions: "4",
          conversionsValue: "400.00",
        },
        {
          date: new Date("2026-05-12T00:00:00.000Z"),
          connectorAccountId: "google-1",
          source: ConnectorProvider.GOOGLE_ADS,
          campaignId: "c2",
          campaignName: "Performance Max",
          campaignStatus: "ENABLED",
          campaignObjective: "PERFORMANCE_MAX",
          spend: "50.00",
          impressions: BigInt(500),
          clicks: BigInt(40),
          sessions: BigInt(30),
          addToCart: BigInt(5),
          conversions: "2",
          conversionsValue: "300.00",
        },
        {
          date: new Date("2026-05-04T00:00:00.000Z"),
          connectorAccountId: "meta-1",
          source: ConnectorProvider.META_ADS,
          campaignId: "old",
          campaignName: "Anterior",
          spend: "50.00",
          impressions: BigInt(200),
          clicks: BigInt(20),
          sessions: BigInt(12),
          conversions: "0",
          conversionsValue: "0.00",
        },
      ],
      orderItems: [
        {
          productName: "Produto A",
          categoryName: "Acessórios",
          quantity: 2,
          total: "200.00",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
        {
          productName: "Produto B",
          categoryName: null,
          quantity: 1,
          total: "300.00",
          status: "aprovado",
          placedAt: new Date("2026-05-12T10:00:00.000Z"),
        },
        {
          productName: "Produto Cancelado",
          categoryName: "Cancelados",
          quantity: 1,
          total: "999.00",
          status: "refunded",
          placedAt: new Date("2026-05-12T11:00:00.000Z"),
        },
      ],
      connectorAccounts: [
        {
          id: "shopify-1",
          provider: ConnectorProvider.SHOPIFY,
          accountName: "Loja Shopify",
        },
        {
          id: "nuvemshop-1",
          provider: ConnectorProvider.NUVEMSHOP,
          accountName: "Loja Nuvemshop",
        },
        {
          id: "meta-1",
          provider: ConnectorProvider.META_ADS,
          accountName: "Meta Cliente",
        },
        {
          id: "google-1",
          provider: ConnectorProvider.GOOGLE_ADS,
          accountName: "Google Cliente",
        },
      ],
    });

    expect(snapshot.kpis.revenue.value).toBe(500);
    expect(snapshot.kpis.spend.value).toBe(150);
    expect(snapshot.kpis.orders.value).toBe(2);
    expect(snapshot.kpis.approvedOrders.value).toBe(2);
    expect(snapshot.kpis.approvedOrders.previousValue).toBe(0);
    expect(snapshot.kpis.roas.value).toBe(3.33);
    expect(snapshot.platformRoas.meta.value).toBe(4);
    expect(snapshot.platformRoas.google.value).toBe(6);
    expect(snapshot.kpis.averageOrderValue.value).toBe(250);
    expect(snapshot.kpis.mediaRate.value).toBe(30);
    expect(snapshot.kpis.conversionRate.value).toBe(1.82);
    expect(snapshot.kpis.costPerSession.value).toBe(1.36);
    expect(snapshot.kpis.sessions.value).toBe(110);
    // Cancelado order in the previous period no longer counts toward
    // previousRevenue, so previous=0. With no baseline, calculateDeltaPercent
    // signals direction at the ±DELTA_PERCENT_CAP (999) instead of fabricating a
    // finite magnitude.
    expect(snapshot.kpis.revenue.deltaPercent).toBe(999);
    expect(snapshot.funnel).toMatchObject({
      impressions: 1500,
      clicks: 140,
      sessions: 110,
      addToCart: 5,
      purchases: 6,
      orders: 2,
    });
    expect(snapshot.funnel.stages).toHaveLength(5);
    expect(
      snapshot.funnel.stages.find((stage) => stage.id === "add_to_cart"),
    ).toMatchObject({
      value: 5,
      available: true,
    });
    expect(snapshot.topCampaigns[0]).toMatchObject({
      campaignId: "c2",
      campaignName: "Performance Max",
      source: ConnectorProvider.GOOGLE_ADS,
      campaignStatus: "ENABLED",
      campaignObjective: "PERFORMANCE_MAX",
      impressions: 500,
      clicks: 40,
      conversions: 2,
      ctr: 8,
      cpc: 1.25,
      costPerConversion: 25,
      conversionsPerCost: 6,
      addToCart: 5,
      costPerAddToCart: 10,
      roas: 6,
    });
    expect(snapshot.lineSeries).toHaveLength(7);
    expect(
      snapshot.lineSeries.find((item) => item.date === "2026-05-10"),
    ).toMatchObject({
      revenue: 200,
      orders: 1,
      averageOrderValue: 200,
      mediaRate: 50,
    });
    // 2026-05-11 maps to previous-period day 2026-05-04 where the only order
    // was cancelado — now filtered out of revenue, so previousMediaRate
    // collapses to 0 (denominator is zero, no approved revenue).
    expect(
      snapshot.lineSeries.find((item) => item.date === "2026-05-11"),
    ).toMatchObject({
      previousMediaRate: 0,
    });
    expect(snapshot.originMedia[0]).toMatchObject({
      label: "meta / cpc",
      value: 300,
      percent: 60,
    });
    expect(snapshot.connectorRanking).toHaveLength(4);
    expect(snapshot.connectorRanking[0]).toMatchObject({
      accountName: "Loja Nuvemshop",
      revenue: 300,
    });
    expect(snapshot.stateSales[0]).toMatchObject({
      label: "RJ",
      value: 300,
      percent: 60,
    });
    expect(snapshot.stateOrders[0]).toMatchObject({
      label: "SP",
      value: 1,
      percent: 50,
    });
    expect(snapshot.products[0]).toMatchObject({
      productName: "Produto B",
      quantitySold: 1,
      revenue: 300,
      averagePrice: 300,
      stockQuantity: null,
    });
    expect(snapshot.products[1]).toMatchObject({
      productName: "Produto A",
      quantitySold: 2,
      revenue: 200,
      averagePrice: 100,
      stockQuantity: null,
    });
    expect(snapshot.categories).toEqual([
      {
        categoryName: "Sem categoria",
        quantitySold: 1,
        revenue: 300,
        percent: 60,
      },
      {
        categoryName: "Acessórios",
        quantitySold: 2,
        revenue: 200,
        percent: 40,
      },
    ]);
  });

  it("filters traffic and commerce providers before calculating blended ROAS", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      commerceProviders: [ConnectorProvider.SHOPIFY],
      trafficProviders: [ConnectorProvider.META_ADS],
      orders: [
        {
          connectorAccountId: "shopify-1",
          platform: ConnectorProvider.SHOPIFY,
          orderTotal: "500.00",
          status: "pago",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
        {
          connectorAccountId: "nuvemshop-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "900.00",
          status: "pago",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
      ],
      metrics: [
        {
          connectorAccountId: "meta-1",
          source: ConnectorProvider.META_ADS,
          date: new Date("2026-05-10T00:00:00.000Z"),
          campaignId: "meta",
          campaignName: "Meta",
          spend: "100.00",
          impressions: BigInt(1),
          clicks: BigInt(1),
          sessions: BigInt(50),
          conversions: "1",
          conversionsValue: "500.00",
        },
        {
          connectorAccountId: "google-1",
          source: ConnectorProvider.GOOGLE_ADS,
          date: new Date("2026-05-10T00:00:00.000Z"),
          campaignId: "google",
          campaignName: "Google",
          spend: "300.00",
          impressions: BigInt(1),
          clicks: BigInt(1),
          sessions: BigInt(50),
          conversions: "1",
          conversionsValue: "900.00",
        },
      ],
    });

    expect(snapshot.kpis.revenue.value).toBe(500);
    expect(snapshot.kpis.spend.value).toBe(100);
    expect(snapshot.kpis.roas.value).toBe(5);
    expect(snapshot.kpis.mediaRate.value).toBe(20);
  });

  it("counts Google Sheets daily rows by external WhatsApp sales quantity", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [
        {
          connectorAccountId: "sheets-1",
          platform: ConnectorProvider.GOOGLE_SHEETS,
          orderTotal: "2848.75",
          itemsCount: 11,
          status: "APPROVED",
          utmSource: "whatsapp",
          // Midday UTC so BRT (-3) day bucketing keeps it on 2026-05-10.
          placedAt: new Date("2026-05-10T12:00:00.000Z"),
        },
      ],
      metrics: [
        {
          connectorAccountId: "meta-1",
          source: ConnectorProvider.META_ADS,
          date: new Date("2026-05-10T00:00:00.000Z"),
          campaignId: "meta",
          campaignName: "Meta",
          spend: "100.00",
          impressions: BigInt(1000),
          clicks: BigInt(100),
          sessions: BigInt(500),
          conversions: "11",
          conversionsValue: "2848.75",
        },
      ],
    });

    expect(snapshot.kpis.revenue.value).toBe(2848.75);
    expect(snapshot.kpis.orders.value).toBe(11);
    expect(snapshot.kpis.approvedOrders.value).toBe(11);
    expect(snapshot.kpis.averageOrderValue.value).toBe(258.98);
    expect(snapshot.kpis.roas.value).toBe(28.49);
    expect(
      snapshot.lineSeries.find((item) => item.date === "2026-05-10"),
    ).toMatchObject({
      revenue: 2848.75,
      orders: 11,
      averageOrderValue: 258.98,
    });
  });

  it("does not invent campaign costs when clicks or conversions are zero", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [
        {
          connectorAccountId: "meta-1",
          source: ConnectorProvider.META_ADS,
          date: new Date("2026-05-10T00:00:00.000Z"),
          campaignId: "meta-zero",
          campaignName: "Meta sem conversão",
          spend: "100.00",
          impressions: BigInt(1000),
          clicks: BigInt(0),
          sessions: BigInt(0),
          conversions: "0",
          conversionsValue: "0.00",
        },
      ],
    });

    expect(snapshot.topCampaigns[0]).toMatchObject({
      campaignId: "meta-zero",
      cpc: null,
      costPerConversion: null,
      costPerAddToCart: null,
      conversionsPerCost: 0,
    });
  });

  it("keeps category percentages safe when item revenue is zero", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [],
      orderItems: [
        {
          productName: "Produto sem receita",
          categoryName: null,
          quantity: 2,
          total: "0.00",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
      ],
    });

    expect(snapshot.categories).toEqual([
      {
        categoryName: "Sem categoria",
        quantitySold: 2,
        revenue: 0,
        percent: 0,
      },
    ]);
  });

  it("resolves stock into number / unlimited / no-data states", () => {
    const period = getDashboardPeriod(
      { period: "week" },
      new Date("2026-05-16T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      orders: [],
      metrics: [],
      orderItems: [
        {
          productName: "Tracked",
          categoryName: null,
          quantity: 1,
          total: "30.00",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
        {
          productName: "Unlimited",
          categoryName: null,
          quantity: 1,
          total: "20.00",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
        {
          productName: "Untouched",
          categoryName: null,
          quantity: 1,
          total: "10.00",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
        {
          productName: "Mixed",
          categoryName: null,
          quantity: 1,
          total: "5.00",
          placedAt: new Date("2026-05-10T10:00:00.000Z"),
        },
      ],
      inventory: [
        { productName: "Tracked", quantity: 7, sku: null, categoryName: null },
        {
          productName: "Unlimited",
          quantity: null,
          sku: null,
          categoryName: null,
        },
        // Same product seen as tracked-0 AND unlimited → still available.
        { productName: "Mixed", quantity: 0, sku: null, categoryName: null },
        {
          productName: "Mixed",
          quantity: null,
          sku: null,
          categoryName: null,
        },
      ],
    });

    const byName = new Map(
      snapshot.products.map((product) => [product.productName, product]),
    );
    expect(byName.get("Tracked")?.stockQuantity).toBe(7);
    expect(byName.get("Unlimited")?.stockQuantity).toBe("unlimited");
    expect(byName.get("Untouched")?.stockQuantity).toBeNull();
    expect(byName.get("Mixed")?.stockQuantity).toBe("unlimited");
  });

  it("buckets NuvemShop revenue by orderCreatedAt with placedAt fallback", () => {
    const period = getDashboardPeriod(
      { period: "custom", from: "2026-06-01", to: "2026-06-30" },
      new Date("2026-07-15T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      commerceProviders: [ConnectorProvider.NUVEMSHOP],
      orders: [
        {
          // Created in June, PAID in July → must count in June.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "100.00",
          status: "paid",
          orderCreatedAt: new Date("2026-06-15T12:00:00.000Z"),
          placedAt: new Date("2026-07-10T12:00:00.000Z"),
        },
        {
          // Legacy row (orderCreatedAt null) → falls back to placedAt in June.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "40.00",
          status: "paid",
          placedAt: new Date("2026-06-20T12:00:00.000Z"),
        },
        {
          // Created in June but cancelled → revenue zero.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "999.00",
          status: "cancelado",
          orderCreatedAt: new Date("2026-06-05T12:00:00.000Z"),
          placedAt: new Date("2026-06-05T12:00:00.000Z"),
        },
        {
          // BRT boundary: 2026-06-30 23:30 BRT = 2026-07-01T02:30Z → June.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "10.00",
          status: "paid",
          orderCreatedAt: new Date("2026-07-01T02:30:00.000Z"),
          placedAt: new Date("2026-07-01T02:30:00.000Z"),
        },
      ],
      metrics: [],
    });

    // 100 (June-created, July-paid) + 40 (fallback) + 10 (BRT boundary) = 150.
    expect(snapshot.kpis.revenue.value).toBe(150);
    expect(snapshot.kpis.approvedOrders.value).toBe(3);
  });
});
