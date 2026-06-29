import Decimal from "decimal.js";
import { ConnectorProvider, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

import { isApprovedOrderStatus } from "./order-status";
import {
  dashboardCommerceProviders,
  dashboardTrafficProviders,
  listDateKeys,
  toDateKey,
  type DashboardPeriod,
} from "./period";

export { isApprovedOrderStatus };

type NumericLike = Decimal.Value | null | undefined;

export type DashboardOrderRow = {
  connectorAccountId: string;
  platform: ConnectorProvider;
  orderTotal: NumericLike;
  itemsCount?: number | null;
  status?: string | null;
  shippingState?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  placedAt: Date;
};

export type DashboardOrderItemRow = {
  productName: string;
  sku?: string | null;
  categoryName?: string | null;
  quantity: number;
  total: NumericLike;
  status?: string | null;
  placedAt: Date;
};

export type DashboardMetricRow = {
  connectorAccountId: string;
  source: ConnectorProvider;
  date: Date;
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus?: string | null;
  campaignObjective?: string | null;
  spend: NumericLike;
  impressions: bigint | number | null;
  clicks: bigint | number | null;
  addToCart?: bigint | number | null;
  sessions: bigint | number | null;
  conversions: NumericLike;
  conversionsValue: NumericLike;
};

export type DashboardConnectorRow = {
  id: string;
  provider: ConnectorProvider;
  accountName: string;
};

type DashboardSnapshotQueryInput = {
  workspaceId: string;
  period: DashboardPeriod;
  trafficProviders: ConnectorProvider[];
  commerceProviders: ConnectorProvider[];
};

export type DashboardKpi = {
  value: number;
  previousValue: number;
  deltaPercent: number;
};

export type DashboardSnapshot = {
  hasData: boolean;
  fetchError: "schema_error" | "db_error" | null;
  kpis: {
    revenue: DashboardKpi;
    spend: DashboardKpi;
    roas: DashboardKpi;
    approvedOrders: DashboardKpi;
    orders: DashboardKpi;
    averageOrderValue: DashboardKpi;
    mediaRate: DashboardKpi;
    conversionRate: DashboardKpi;
    costPerSession: DashboardKpi;
    sessions: DashboardKpi;
  };
  lineSeries: Array<{
    date: string;
    label: string;
    revenue: number;
    spend: number;
    orders: number;
    averageOrderValue: number;
    mediaRate: number;
    previousMediaRate: number;
    conversionRate: number;
    costPerSession: number;
    roas: number;
    metaRoas: number;
    googleRoas: number;
    previousRevenue: number;
    previousSpend: number;
    previousOrders: number;
    previousAverageOrderValue: number;
  }>;
  platformRoas: {
    meta: DashboardKpi;
    google: DashboardKpi;
  };
  topCampaigns: Array<{
    campaignId: string;
    campaignName: string;
    campaignStatus: string | null;
    campaignObjective: string | null;
    source: ConnectorProvider;
    spend: number;
    impressions: number;
    clicks: number;
    addToCart: number;
    conversions: number;
    conversionsValue: number;
    ctr: number;
    cpc: number | null;
    costPerAddToCart: number | null;
    costPerConversion: number | null;
    conversionsPerCost: number;
    roas: number;
  }>;
  funnel: {
    impressions: number;
    clicks: number;
    sessions: number;
    addToCart: number;
    checkouts: number;
    purchases: number;
    orders: number;
    stages: Array<{
      id: "sessions" | "add_to_cart" | "checkouts" | "purchases" | "orders";
      label: string;
      value: number;
      available: boolean;
      percentOfFirstStage: number;
    }>;
  };
  stateSales: Array<DashboardBreakdownItem>;
  stateOrders: Array<DashboardBreakdownItem>;
  originMedia: Array<DashboardBreakdownItem>;
  products: Array<DashboardProductRow>;
  categories: Array<DashboardCategoryRow>;
  connectorRanking: Array<DashboardConnectorRankingRow>;
};

export type DashboardBreakdownItem = {
  label: string;
  value: number;
  percent: number;
};

export type DashboardProductRow = {
  productName: string;
  quantitySold: number;
  revenue: number;
  averagePrice: number;
  // number → tracked count · "unlimited" → store doesn't track ("Disponível")
  // · null → no catalog match ("Sem dado")
  stockQuantity: number | "unlimited" | null;
};

export type DashboardCategoryRow = {
  categoryName: string;
  quantitySold: number;
  revenue: number;
  percent: number;
};

export type DashboardConnectorRankingRow = {
  connectorAccountId: string;
  accountName: string;
  provider: ConnectorProvider;
  revenue: number;
  spend: number;
  orders: number;
  roas: number;
  mediaRate: number;
};

function asNumber(value: NumericLike) {
  if (value === null || value === undefined) {
    return 0;
  }

  return new Decimal(value).toNumber();
}

function asInteger(value: bigint | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

function isWithin(date: Date, from: Date, to: Date) {
  const key = toDateKey(date);
  return key >= toDateKey(from) && key <= toDateKey(to);
}

// Brazil (America/Sao_Paulo) is a fixed UTC-3 — no DST since 2019. Order
// timestamps are stored in UTC, but the dashboard's calendar day must follow
// the store's LOCAL (BRT) day. Otherwise late-night BRT orders, which fall on
// the next UTC day, are bucketed into the wrong day's GMV (a 21:39 BRT sale on
// the 15th showed up under the 16th). Traffic DailyMetric rows are date-keyed
// in the provider's own day and are intentionally NOT shifted here.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

// BRT calendar date of a UTC instant.
function brtDateKey(date: Date) {
  return toDateKey(new Date(date.getTime() - BRT_OFFSET_MS));
}

function isWithinBrt(date: Date, from: Date, to: Date) {
  const key = brtDateKey(date);
  return key >= toDateKey(from) && key <= toDateKey(to);
}

// UTC instant of the BRT midnight that corresponds to a UTC-midnight period
// bound. Used to scope the SQL placedAt fetch to the BRT day window.
function brtBound(date: Date) {
  return new Date(date.getTime() + BRT_OFFSET_MS);
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function isMissingDashboardSchemaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

export function calculateRoas(revenue: number, spend: number) {
  if (spend <= 0) {
    return 0;
  }

  return round(revenue / spend);
}

export function calculateRatioPercent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return round((numerator / denominator) * 100);
}

// Cap runaway deltas (e.g. previous≈0) so the UI never shows +999900%.
const DELTA_PERCENT_CAP = 999;

export function calculateDeltaPercent(current: number, previous: number) {
  if (previous === 0) {
    // No baseline: signal direction, don't fabricate a magnitude.
    if (current === 0) return 0;
    return current > 0 ? DELTA_PERCENT_CAP : -DELTA_PERCENT_CAP;
  }

  const raw = ((current - previous) / Math.abs(previous)) * 100;
  const capped = Math.max(-DELTA_PERCENT_CAP, Math.min(DELTA_PERCENT_CAP, raw));
  return round(capped, 1);
}

function kpi(current: number, previous: number): DashboardKpi {
  return {
    value: round(current),
    previousValue: round(previous),
    deltaPercent: calculateDeltaPercent(current, previous),
  };
}

function orderCount(order: DashboardOrderRow) {
  if (order.platform === ConnectorProvider.GOOGLE_SHEETS) {
    return Math.max(0, order.itemsCount ?? 0);
  }

  return 1;
}

function approvedOrderCount(order: DashboardOrderRow) {
  return isApprovedOrderStatus(order.status, order.platform) ? orderCount(order) : 0;
}

// isApprovedOrderStatus is imported from ./order-status and re-exported above.

function applyPercent(items: Array<Omit<DashboardBreakdownItem, "percent">>) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return items
    .map((item) => ({
      ...item,
      value: round(item.value),
      percent: total > 0 ? round((item.value / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function applyCategoryPercent(
  items: Array<Omit<DashboardCategoryRow, "percent">>,
) {
  const total = items.reduce((sum, item) => sum + item.revenue, 0);

  return items
    .map((item) => ({
      ...item,
      revenue: round(item.revenue),
      percent: total > 0 ? round((item.revenue / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function originLabel(order: DashboardOrderRow) {
  const source = order.utmSource?.trim();
  const medium = order.utmMedium?.trim();

  if (source && medium) {
    return `${source} / ${medium}`;
  }

  if (source) {
    return source;
  }

  if (medium) {
    return medium;
  }

  return "Sem UTM";
}

function buildFunnelStages(input: {
  sessions: number;
  addToCart: number;
  checkouts: number;
  purchases: number;
  orders: number;
}) {
  const first = input.sessions;
  const stage = (
    id: DashboardSnapshot["funnel"]["stages"][number]["id"],
    label: string,
    value: number,
    available: boolean,
  ) => ({
    id,
    label,
    value,
    available,
    percentOfFirstStage: first > 0 ? round((value / first) * 100, 1) : 0,
  });

  return [
    stage("sessions", "Sessões", input.sessions, input.sessions > 0),
    stage(
      "add_to_cart",
      "Adições ao carrinho",
      input.addToCart,
      input.addToCart > 0,
    ),
    stage("checkouts", "Checkouts", input.checkouts, input.checkouts > 0),
    stage("purchases", "Compras", input.purchases, input.purchases > 0),
    stage("orders", "Pedidos", input.orders, input.orders > 0),
  ];
}

export function buildDashboardSnapshot(input: {
  period: DashboardPeriod;
  orders: DashboardOrderRow[];
  orderItems?: DashboardOrderItemRow[];
  metrics: DashboardMetricRow[];
  connectorAccounts?: DashboardConnectorRow[];
  inventory?: {
    productName: string;
    quantity: number | null;
    sku?: string | null;
    categoryName?: string | null;
  }[];
  trafficProviders?: ConnectorProvider[];
  commerceProviders?: ConnectorProvider[];
}): DashboardSnapshot {
  const { period } = input;
  // Product catalog (stock + category) synced from the workspace's store
  // connectors. Keyed by SKU (preferred — survives "Produto - VARIANTE" name
  // drift) and by normalized name (fallback). Used to fill the products table's
  // "Estoque disponível" column and to enrich each order item's category for the
  // Categorias widget.
  // ponytail: quantities SUM across connectors — a multi-store workspace's
  // total on-hand. If a SKU is shared across stores this is the combined stock,
  // not a double-count; switch to MAX only if stores mirror the same warehouse.
  // Stock accumulator per product key. `hasNumber` tracks whether any matching
  // catalog row reported a tracked count; `hasUnlimited` whether any row was
  // untracked (sells unlimited). When no row tracked a count — or every tracked
  // row summed to 0 while an unlimited source exists — the product resolves to
  // "unlimited" ("Disponível") rather than a false out-of-stock 0.
  type StockAcc = { sum: number; hasNumber: boolean; hasUnlimited: boolean };
  const inventoryQtyByName = new Map<string, StockAcc>();
  const inventoryQtyBySku = new Map<string, StockAcc>();
  const categoryByName = new Map<string, string>();
  const categoryBySku = new Map<string, string>();
  const accumulateStock = (
    map: Map<string, StockAcc>,
    key: string,
    quantity: number | null,
  ): void => {
    const entry = map.get(key) ?? {
      sum: 0,
      hasNumber: false,
      hasUnlimited: false,
    };
    if (quantity === null) {
      entry.hasUnlimited = true;
    } else {
      entry.sum += quantity;
      entry.hasNumber = true;
    }
    map.set(key, entry);
  };
  for (const item of input.inventory ?? []) {
    const nameKey = item.productName.trim().toLowerCase();
    const skuKey = item.sku?.trim().toLowerCase() || "";
    if (nameKey) {
      accumulateStock(inventoryQtyByName, nameKey, item.quantity);
    }
    if (skuKey) {
      accumulateStock(inventoryQtyBySku, skuKey, item.quantity);
    }
    const category = item.categoryName?.trim();
    if (category) {
      if (nameKey && !categoryByName.has(nameKey)) {
        categoryByName.set(nameKey, category);
      }
      if (skuKey && !categoryBySku.has(skuKey)) {
        categoryBySku.set(skuKey, category);
      }
    }
  }
  // Resolve a product's on-hand stock: SKU match first, then name.
  //   number      → tracked on-hand count (renders the number)
  //   "unlimited" → matched but the store doesn't track stock (renders
  //                 "Disponível")
  //   null        → no catalog row matched (renders "Sem dado")
  // A tracked count wins only when it's positive; a tracked-zero that coexists
  // with an unlimited source is still "available" (don't show a false 0).
  const accToStock = (acc: StockAcc): number | "unlimited" => {
    if (acc.hasNumber && (acc.sum > 0 || !acc.hasUnlimited)) {
      return acc.sum;
    }
    return "unlimited";
  };
  const resolveStock = (
    productName: string,
    sku: string | null | undefined,
  ): number | "unlimited" | null => {
    const skuKey = sku?.trim().toLowerCase() || "";
    const bySku = skuKey ? inventoryQtyBySku.get(skuKey) : undefined;
    if (bySku) {
      return accToStock(bySku);
    }
    const nameKey = productName.trim().toLowerCase();
    const byName = inventoryQtyByName.get(nameKey);
    return byName ? accToStock(byName) : null;
  };
  // Resolve a product's category: explicit order-item category wins, then
  // catalog by SKU, then catalog by name.
  const resolveCategoryName = (
    productName: string,
    sku: string | null | undefined,
    explicit: string | null | undefined,
  ): string | null => {
    const fromItem = explicit?.trim();
    if (fromItem) return fromItem;
    const skuKey = sku?.trim().toLowerCase() || "";
    if (skuKey && categoryBySku.has(skuKey)) {
      return categoryBySku.get(skuKey) ?? null;
    }
    const nameKey = productName.trim().toLowerCase();
    return categoryByName.get(nameKey) ?? null;
  };
  const trafficProviders = input.trafficProviders ?? [
    ...dashboardTrafficProviders,
  ];
  const commerceProviders = input.commerceProviders ?? [
    ...dashboardCommerceProviders,
  ];
  const connectorNames = new Map(
    (input.connectorAccounts ?? []).map(
      (account) => [account.id, account] as const,
    ),
  );
  const filteredOrders = input.orders.filter((order) =>
    commerceProviders.includes(order.platform),
  );
  const filteredMetrics = input.metrics.filter((metric) =>
    trafficProviders.includes(metric.source),
  );
  const filteredOrderItems = (input.orderItems ?? []).filter(
    (item) =>
      isWithinBrt(item.placedAt, period.from, period.to) &&
      // Line items inherit the parent order's paid state and frequently arrive
      // without their own status — count them unless the status is explicitly a
      // non-approved (pending / cancelled / refunded) term. Orders themselves
      // keep the stricter "must be approved" rule (see revenue below).
      (item.status == null || isApprovedOrderStatus(item.status)),
  );
  const currentOrders = filteredOrders.filter((order) =>
    isWithinBrt(order.placedAt, period.from, period.to),
  );
  const previousOrders = input.orders.filter(
    (order) =>
      commerceProviders.includes(order.platform) &&
      isWithinBrt(order.placedAt, period.comparison.from, period.comparison.to),
  );
  const currentMetrics = filteredMetrics.filter((metric) =>
    isWithin(metric.date, period.from, period.to),
  );
  const previousMetrics = input.metrics.filter(
    (metric) =>
      trafficProviders.includes(metric.source) &&
      isWithin(metric.date, period.comparison.from, period.comparison.to),
  );

  // Revenue counts only paid/approved orders — pending / cancelled /
  // refunded amounts are excluded so the headline number matches what
  // the customer sees in their financial panel.
  const revenue = currentOrders.reduce(
    (sum, order) =>
      sum +
      (isApprovedOrderStatus(order.status, order.platform) ? asNumber(order.orderTotal) : 0),
    0,
  );
  const previousRevenue = previousOrders.reduce(
    (sum, order) =>
      sum +
      (isApprovedOrderStatus(order.status, order.platform) ? asNumber(order.orderTotal) : 0),
    0,
  );
  const spend = currentMetrics.reduce(
    (sum, metric) => sum + asNumber(metric.spend),
    0,
  );
  const previousSpend = previousMetrics.reduce(
    (sum, metric) => sum + asNumber(metric.spend),
    0,
  );
  const impressions = currentMetrics.reduce(
    (sum, metric) => sum + asInteger(metric.impressions),
    0,
  );
  const clicks = currentMetrics.reduce(
    (sum, metric) => sum + asInteger(metric.clicks),
    0,
  );
  const addToCart = currentMetrics.reduce(
    (sum, metric) => sum + asInteger(metric.addToCart),
    0,
  );
  const sessions = currentMetrics.reduce(
    (sum, metric) => sum + asInteger(metric.sessions),
    0,
  );
  const previousSessions = previousMetrics.reduce(
    (sum, metric) => sum + asInteger(metric.sessions),
    0,
  );
  const roas = calculateRoas(revenue, spend);
  const previousRoas = calculateRoas(previousRevenue, previousSpend);
  const approvedOrders = currentOrders.reduce(
    (sum, order) => sum + approvedOrderCount(order),
    0,
  );
  const previousApprovedOrders = previousOrders.reduce(
    (sum, order) => sum + approvedOrderCount(order),
    0,
  );
  const orders = approvedOrders;
  const previousOrderCount = previousApprovedOrders;
  const averageOrderValue = orders > 0 ? revenue / orders : 0;
  const previousAverageOrderValue =
    previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;
  const mediaRate = calculateRatioPercent(spend, revenue);
  const previousMediaRate = calculateRatioPercent(
    previousSpend,
    previousRevenue,
  );
  const conversionRate = calculateRatioPercent(orders, sessions);
  const previousConversionRate = calculateRatioPercent(
    previousOrderCount,
    previousSessions,
  );
  const costPerSession = sessions > 0 ? spend / sessions : 0;
  const previousCostPerSession =
    previousSessions > 0 ? previousSpend / previousSessions : 0;
  const daily = new Map(
    listDateKeys(period.from, period.to).map((date) => [
      date,
      {
        date,
        label: date.slice(5).replace("-", "/"),
        revenue: 0,
        spend: 0,
        orders: 0,
        approvedOrders: 0,
        averageOrderValue: 0,
        sessions: 0,
        mediaRate: 0,
        previousMediaRate: 0,
        conversionRate: 0,
        costPerSession: 0,
        roas: 0,
        metaSpend: 0,
        metaConversionsValue: 0,
        metaRoas: 0,
        googleSpend: 0,
        googleConversionsValue: 0,
        googleRoas: 0,
        previousRevenue: 0,
        previousSpend: 0,
        previousOrders: 0,
        previousApprovedOrders: 0,
        previousAverageOrderValue: 0,
      },
    ]),
  );

  for (const order of currentOrders) {
    const item = daily.get(brtDateKey(order.placedAt));
    if (item) {
      const approved = approvedOrderCount(order);
      // Same rule as the headline revenue: only paid orders count toward the
      // daily revenue series so the line chart matches the KPI total.
      if (isApprovedOrderStatus(order.status, order.platform)) {
        item.revenue += asNumber(order.orderTotal);
      }
      item.orders += approved;
      item.approvedOrders += approved;
    }
  }

  for (const metric of currentMetrics) {
    const item = daily.get(toDateKey(metric.date));
    if (item) {
      item.spend += asNumber(metric.spend);
      item.sessions += asInteger(metric.sessions);
      if (metric.source === ConnectorProvider.META_ADS) {
        item.metaSpend += asNumber(metric.spend);
        item.metaConversionsValue += asNumber(metric.conversionsValue);
      }
      if (metric.source === ConnectorProvider.GOOGLE_ADS) {
        item.googleSpend += asNumber(metric.spend);
        item.googleConversionsValue += asNumber(metric.conversionsValue);
      }
    }
  }

  const currentDateKeys = listDateKeys(period.from, period.to);
  const previousDateKeys = listDateKeys(
    period.comparison.from,
    period.comparison.to,
  );
  const alignedDates = currentDateKeys.map((date, index) => ({
    current: date,
    previous: previousDateKeys[index],
  }));
  const alignedByPreviousDate = new Map(
    alignedDates
      .filter((item): item is { current: string; previous: string } =>
        Boolean(item.previous),
      )
      .map((item) => [item.previous, item.current] as const),
  );

  for (const order of previousOrders) {
    const currentKey = alignedByPreviousDate.get(brtDateKey(order.placedAt));
    const item = currentKey ? daily.get(currentKey) : null;
    if (item) {
      const approved = approvedOrderCount(order);
      if (isApprovedOrderStatus(order.status, order.platform)) {
        item.previousRevenue += asNumber(order.orderTotal);
      }
      item.previousOrders += approved;
      item.previousApprovedOrders += approved;
    }
  }

  for (const metric of previousMetrics) {
    const currentKey = alignedByPreviousDate.get(toDateKey(metric.date));
    const item = currentKey ? daily.get(currentKey) : null;
    if (item) {
      item.previousSpend += asNumber(metric.spend);
    }
  }

  const campaigns = new Map<
    string,
    {
      campaignId: string;
      campaignName: string;
      campaignStatus: string | null;
      campaignStatusDate: Date | null;
      campaignObjective: string | null;
      source: ConnectorProvider;
      spend: number;
      impressions: number;
      clicks: number;
      addToCart: number;
      conversions: number;
      conversionsValue: number;
    }
  >();
  const providerPerformance = new Map<
    ConnectorProvider,
    {
      spend: number;
      conversionsValue: number;
      previousSpend: number;
      previousConversionsValue: number;
    }
  >();

  for (const metric of currentMetrics) {
    const campaignId = metric.campaignId ?? "sem-campanha";
    const campaignKey = `${metric.source}:${campaignId}`;
    const existing = campaigns.get(campaignKey) ?? {
      campaignId,
      campaignName: metric.campaignName ?? "Sem campanha",
      campaignStatus: metric.campaignStatus ?? null,
      campaignStatusDate: metric.campaignStatus ? metric.date : null,
      campaignObjective: metric.campaignObjective ?? null,
      source: metric.source,
      spend: 0,
      impressions: 0,
      clicks: 0,
      addToCart: 0,
      conversions: 0,
      conversionsValue: 0,
    };

    existing.spend += asNumber(metric.spend);
    // Use the status from the row with the LATEST date — a campaign paused
    // late in the period (or after a previous sync) must report as paused
    // even if older rows still carry the old "ACTIVE" snapshot.
    if (
      metric.campaignStatus &&
      (!existing.campaignStatusDate ||
        metric.date >= existing.campaignStatusDate)
    ) {
      existing.campaignStatus = metric.campaignStatus;
      existing.campaignStatusDate = metric.date;
    }
    existing.campaignObjective =
      existing.campaignObjective ?? metric.campaignObjective ?? null;
    existing.impressions += asInteger(metric.impressions);
    existing.clicks += asInteger(metric.clicks);
    existing.addToCart += asInteger(metric.addToCart);
    existing.conversions += asNumber(metric.conversions);
    existing.conversionsValue += asNumber(metric.conversionsValue);
    campaigns.set(campaignKey, existing);

    const provider = providerPerformance.get(metric.source) ?? {
      spend: 0,
      conversionsValue: 0,
      previousSpend: 0,
      previousConversionsValue: 0,
    };
    provider.spend += asNumber(metric.spend);
    provider.conversionsValue += asNumber(metric.conversionsValue);
    providerPerformance.set(metric.source, provider);
  }

  for (const metric of previousMetrics) {
    const provider = providerPerformance.get(metric.source) ?? {
      spend: 0,
      conversionsValue: 0,
      previousSpend: 0,
      previousConversionsValue: 0,
    };
    provider.previousSpend += asNumber(metric.spend);
    provider.previousConversionsValue += asNumber(metric.conversionsValue);
    providerPerformance.set(metric.source, provider);
  }

  const purchases = currentMetrics.reduce(
    (sum, metric) => sum + asNumber(metric.conversions),
    0,
  );
  const originRevenue = new Map<string, number>();
  const stateRevenue = new Map<string, number>();
  const stateOrderCounts = new Map<string, number>();
  const productRevenue = new Map<
    string,
    {
      productName: string;
      sku: string | null;
      quantitySold: number;
      revenue: number;
    }
  >();
  const categoryRevenue = new Map<
    string,
    {
      categoryName: string;
      quantitySold: number;
      revenue: number;
    }
  >();
  const connectorRanking = new Map<
    string,
    {
      connectorAccountId: string;
      accountName: string;
      provider: ConnectorProvider;
      revenue: number;
      spend: number;
      orders: number;
    }
  >();

  for (const order of currentOrders) {
    const approved = isApprovedOrderStatus(order.status, order.platform);
    const approvedCount = approved ? orderCount(order) : 0;
    const orderTotal = asNumber(order.orderTotal);
    const revenueContribution = approved ? orderTotal : 0;

    if (approved) {
      originRevenue.set(
        originLabel(order),
        (originRevenue.get(originLabel(order)) ?? 0) + revenueContribution,
      );
    }
    const shippingState = order.shippingState?.trim();
    if (approved && shippingState) {
      stateRevenue.set(
        shippingState,
        (stateRevenue.get(shippingState) ?? 0) + revenueContribution,
      );
      stateOrderCounts.set(
        shippingState,
        (stateOrderCounts.get(shippingState) ?? 0) + approvedCount,
      );
    }
    const account = connectorNames.get(order.connectorAccountId);
    const existing = connectorRanking.get(order.connectorAccountId) ?? {
      connectorAccountId: order.connectorAccountId,
      accountName: account?.accountName ?? "Loja sem nome",
      provider: account?.provider ?? order.platform,
      revenue: 0,
      spend: 0,
      orders: 0,
    };

    existing.revenue += revenueContribution;
    existing.orders += approvedCount;
    connectorRanking.set(order.connectorAccountId, existing);
  }

  for (const metric of currentMetrics) {
    const account = connectorNames.get(metric.connectorAccountId);
    const existing = connectorRanking.get(metric.connectorAccountId) ?? {
      connectorAccountId: metric.connectorAccountId,
      accountName: account?.accountName ?? "Conta de mídia sem nome",
      provider: account?.provider ?? metric.source,
      revenue: 0,
      spend: 0,
      orders: 0,
    };

    existing.spend += asNumber(metric.spend);
    connectorRanking.set(metric.connectorAccountId, existing);
  }

  // Sort by value BEFORE slicing — Map iteration is insertion order, so a bare
  // slice(0,8) would keep the first 8 labels seen, not the top 8 by value.
  const topByValue = (entries: Map<string, number>) =>
    Array.from(entries.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  const originMedia = applyPercent(topByValue(originRevenue));
  const stateSales = applyPercent(topByValue(stateRevenue));
  const stateOrders = applyPercent(topByValue(stateOrderCounts));
  for (const item of filteredOrderItems) {
    const existing = productRevenue.get(item.productName) ?? {
      productName: item.productName,
      sku: null as string | null,
      quantitySold: 0,
      revenue: 0,
    };
    existing.quantitySold += item.quantity;
    existing.revenue += asNumber(item.total);
    // Keep the first SKU seen for this product name so the stock join can match
    // by SKU even though products are aggregated by name.
    if (!existing.sku && item.sku?.trim()) {
      existing.sku = item.sku.trim();
    }
    productRevenue.set(item.productName, existing);

    const categoryName =
      resolveCategoryName(item.productName, item.sku, item.categoryName) ||
      "Sem categoria";
    const category = categoryRevenue.get(categoryName) ?? {
      categoryName,
      quantitySold: 0,
      revenue: 0,
    };
    category.quantitySold += item.quantity;
    category.revenue += asNumber(item.total);
    categoryRevenue.set(categoryName, category);
  }
  const funnelStages = buildFunnelStages({
    sessions,
    addToCart,
    checkouts: 0,
    purchases: round(purchases),
    orders,
  });

  return {
    hasData: currentOrders.length > 0 || currentMetrics.length > 0,
    fetchError: null as null,
    kpis: {
      revenue: kpi(revenue, previousRevenue),
      spend: kpi(spend, previousSpend),
      roas: kpi(roas, previousRoas),
      approvedOrders: kpi(approvedOrders, previousApprovedOrders),
      orders: kpi(orders, previousOrderCount),
      averageOrderValue: kpi(averageOrderValue, previousAverageOrderValue),
      mediaRate: kpi(mediaRate, previousMediaRate),
      conversionRate: kpi(conversionRate, previousConversionRate),
      costPerSession: kpi(costPerSession, previousCostPerSession),
      sessions: kpi(sessions, previousSessions),
    },
    lineSeries: Array.from(daily.values()).map((item) => ({
      ...item,
      averageOrderValue:
        item.orders > 0 ? round(item.revenue / item.orders) : 0,
      mediaRate: calculateRatioPercent(item.spend, item.revenue),
      previousMediaRate: calculateRatioPercent(
        item.previousSpend,
        item.previousRevenue,
      ),
      conversionRate: calculateRatioPercent(item.orders, item.sessions),
      costPerSession: item.sessions > 0 ? round(item.spend / item.sessions) : 0,
      roas: calculateRoas(item.revenue, item.spend),
      metaRoas: calculateRoas(item.metaConversionsValue, item.metaSpend),
      googleRoas: calculateRoas(item.googleConversionsValue, item.googleSpend),
      previousAverageOrderValue:
        item.previousOrders > 0
          ? round(item.previousRevenue / item.previousOrders)
          : 0,
      revenue: round(item.revenue),
      spend: round(item.spend),
      previousRevenue: round(item.previousRevenue),
      previousSpend: round(item.previousSpend),
    })),
    platformRoas: {
      meta: kpi(
        calculateRoas(
          providerPerformance.get(ConnectorProvider.META_ADS)
            ?.conversionsValue ?? 0,
          providerPerformance.get(ConnectorProvider.META_ADS)?.spend ?? 0,
        ),
        calculateRoas(
          providerPerformance.get(ConnectorProvider.META_ADS)
            ?.previousConversionsValue ?? 0,
          providerPerformance.get(ConnectorProvider.META_ADS)?.previousSpend ??
            0,
        ),
      ),
      google: kpi(
        calculateRoas(
          providerPerformance.get(ConnectorProvider.GOOGLE_ADS)
            ?.conversionsValue ?? 0,
          providerPerformance.get(ConnectorProvider.GOOGLE_ADS)?.spend ?? 0,
        ),
        calculateRoas(
          providerPerformance.get(ConnectorProvider.GOOGLE_ADS)
            ?.previousConversionsValue ?? 0,
          providerPerformance.get(ConnectorProvider.GOOGLE_ADS)
            ?.previousSpend ?? 0,
        ),
      ),
    },
    topCampaigns: Array.from(campaigns.values())
      .map((campaign) => ({
        ...campaign,
        spend: round(campaign.spend),
        impressions: Math.round(campaign.impressions),
        clicks: Math.round(campaign.clicks),
        addToCart: Math.round(campaign.addToCart),
        conversions: round(campaign.conversions),
        conversionsValue: round(campaign.conversionsValue),
        ctr: calculateRatioPercent(campaign.clicks, campaign.impressions),
        cpc:
          campaign.clicks > 0 ? round(campaign.spend / campaign.clicks) : null,
        costPerAddToCart:
          campaign.addToCart > 0
            ? round(campaign.spend / campaign.addToCart)
            : null,
        costPerConversion:
          campaign.conversions > 0
            ? round(campaign.spend / campaign.conversions)
            : null,
        conversionsPerCost: calculateRoas(
          campaign.conversionsValue,
          campaign.spend,
        ),
        roas: calculateRoas(campaign.conversionsValue, campaign.spend),
      }))
      // Keep campaigns with any activity (spend OR impressions OR clicks).
      // Active campaigns with zero spend but visible delivery still surface.
      .filter(
        (campaign) =>
          campaign.spend > 0 || campaign.impressions > 0 || campaign.clicks > 0,
      )
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 10),
    funnel: {
      impressions,
      clicks,
      sessions,
      addToCart,
      checkouts: 0,
      purchases: round(purchases),
      orders,
      stages: funnelStages,
    },
    stateSales,
    stateOrders,
    originMedia,
    products: Array.from(productRevenue.values())
      .map(({ sku, ...product }) => ({
        ...product,
        revenue: round(product.revenue),
        averagePrice:
          product.quantitySold > 0
            ? round(product.revenue / product.quantitySold)
            : 0,
        // Real on-hand stock when a connector synced it; null ("Sem dado")
        // when no catalog row matches by SKU or product name.
        stockQuantity: resolveStock(product.productName, sku),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    categories: applyCategoryPercent(
      Array.from(categoryRevenue.values()),
    ).slice(0, 10),
    connectorRanking: Array.from(connectorRanking.values())
      .filter((row) => row.revenue > 0 || row.spend > 0 || row.orders > 0)
      .map((row) => ({
        ...row,
        revenue: round(row.revenue),
        spend: round(row.spend),
        roas: calculateRoas(row.revenue, row.spend),
        mediaRate: calculateRatioPercent(row.spend, row.revenue),
      }))
      .sort((a, b) => b.revenue + b.spend - (a.revenue + a.spend))
      .slice(0, 10),
  };
}

function buildZeroedDashboardSnapshot(
  input: {
    period: DashboardPeriod;
    trafficProviders: ConnectorProvider[];
    commerceProviders: ConnectorProvider[];
  },
  fetchError: "schema_error" | "db_error",
): DashboardSnapshot {
  const snapshot = buildDashboardSnapshot({
    period: input.period,
    orders: [],
    orderItems: [],
    metrics: [],
    connectorAccounts: [],
    trafficProviders: input.trafficProviders,
    commerceProviders: input.commerceProviders,
  });

  return {
    ...snapshot,
    fetchError,
  };
}

export async function getDashboardSnapshot(input: {
  workspaceId: string;
  period: DashboardPeriod;
  trafficProviders?: ConnectorProvider[];
  commerceProviders?: ConnectorProvider[];
}): Promise<DashboardSnapshot> {
  const trafficProviders = input.trafficProviders ?? [
    ...dashboardTrafficProviders,
  ];
  const commerceProviders = input.commerceProviders ?? [
    ...dashboardCommerceProviders,
  ];

  const queryInput = {
    workspaceId: input.workspaceId,
    period: input.period,
    trafficProviders,
    commerceProviders,
  };

  try {
    const [orders, orderItems, metrics, connectorAccounts] = await Promise.all([
      findDashboardOrders(queryInput),
      findDashboardOrderItems(queryInput),
      prisma.dailyMetric.findMany({
        where: {
          workspaceId: input.workspaceId,
          source: {
            in: trafficProviders,
          },
          date: {
            gte: input.period.comparison.from,
            lt: dayAfter(input.period.to),
          },
        },
        select: {
          connectorAccountId: true,
          source: true,
          date: true,
          campaignId: true,
          campaignName: true,
          campaignStatus: true,
          campaignObjective: true,
          spend: true,
          impressions: true,
          clicks: true,
          addToCart: true,
          sessions: true,
          conversions: true,
          conversionsValue: true,
        },
      }),
      prisma.connectorAccount.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            {
              provider: {
                in: trafficProviders,
              },
            },
            {
              provider: {
                in: commerceProviders,
              },
            },
          ],
        },
        select: {
          id: true,
          provider: true,
          accountName: true,
        },
      }),
    ]);

    // Inventory is supplementary; fetch it defensively so a missing table
    // (pre-migration) or transient error degrades to "Sem dado" instead of
    // failing the whole dashboard.
    const inventory = await findDashboardInventory(input.workspaceId);

    return buildDashboardSnapshot({
      period: input.period,
      orders,
      orderItems,
      metrics,
      connectorAccounts,
      inventory,
      trafficProviders,
      commerceProviders,
    });
  } catch (error: unknown) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
    const fetchError: "schema_error" | "db_error" =
      code === "P2021" || code === "P2022" ? "schema_error" : "db_error";

    return buildZeroedDashboardSnapshot(
      {
        period: input.period,
        trafficProviders,
        commerceProviders,
      },
      fetchError,
    );
  }
}

/**
 * Current on-hand stock per product for the workspace. Defensive by design: a
 * missing ProductInventory table (before the migration runs) or any transient
 * error returns [] so the products table degrades to "Sem dado" rather than
 * breaking the whole dashboard.
 */
async function findDashboardInventory(workspaceId: string): Promise<
  {
    productName: string;
    quantity: number | null;
    sku: string | null;
    categoryName: string | null;
  }[]
> {
  try {
    return await prisma.productInventory.findMany({
      where: { workspaceId },
      select: {
        productName: true,
        quantity: true,
        sku: true,
        categoryName: true,
      },
    });
  } catch {
    return [];
  }
}

// period.to and period.comparison.from/to are normalized to start-of-UTC-day
// upstream. For date-range filters we want the entire `to` day included, so
// we add one day and use `lt` instead of `lte`.
function dayAfter(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function findDashboardOrders(
  input: DashboardSnapshotQueryInput,
): Promise<DashboardOrderRow[]> {
  const where = {
    workspaceId: input.workspaceId,
    platform: {
      in: input.commerceProviders,
    },
    // BRT day window (UTC-3): shift the UTC-midnight bounds by +3h so the fetch
    // covers the store's local day. Precise per-day bucketing happens in-memory
    // via brtDateKey/isWithinBrt.
    placedAt: {
      gte: brtBound(input.period.comparison.from),
      lt: brtBound(dayAfter(input.period.to)),
    },
  };

  try {
    return await prisma.ecommerceOrder.findMany({
      where,
      select: {
        connectorAccountId: true,
        platform: true,
        orderTotal: true,
        itemsCount: true,
        status: true,
        shippingState: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        placedAt: true,
      },
    });
  } catch (error) {
    if (!isMissingDashboardSchemaError(error)) {
      throw error;
    }

    const legacyOrders = await prisma.ecommerceOrder.findMany({
      where,
      select: {
        connectorAccountId: true,
        platform: true,
        orderTotal: true,
        itemsCount: true,
        status: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        placedAt: true,
      },
    });

    return legacyOrders.map((order) => ({
      ...order,
      status: order.status,
      shippingState: null,
    }));
  }
}

async function findDashboardOrderItems(
  input: DashboardSnapshotQueryInput,
): Promise<DashboardOrderItemRow[]> {
  try {
    const rows = await prisma.ecommerceOrderItem.findMany({
      where: {
        workspaceId: input.workspaceId,
        ecommerceOrder: {
          platform: {
            in: input.commerceProviders,
          },
        },
        // BRT day window (UTC-3) — see findDashboardOrders.
        placedAt: {
          gte: brtBound(input.period.from),
          lt: brtBound(dayAfter(input.period.to)),
        },
      },
      select: {
        productName: true,
        sku: true,
        quantity: true,
        total: true,
        placedAt: true,
        ecommerceOrder: {
          select: {
            status: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      productName: row.productName,
      sku: row.sku,
      quantity: row.quantity,
      total: row.total,
      placedAt: row.placedAt,
      status: row.ecommerceOrder.status,
      categoryName: null,
    }));
  } catch (error) {
    if (isMissingDashboardSchemaError(error)) {
      return [];
    }

    throw error;
  }
}
