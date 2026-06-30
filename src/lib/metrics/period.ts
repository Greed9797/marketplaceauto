import { ConnectorProvider } from "@prisma/client";

import {
  MARKETPLACE_FIRST,
  MARKETPLACE_PROVIDERS,
} from "@/lib/connectors/marketplace-first";

export type DashboardPeriodPreset =
  | "day"
  | "yesterday"
  | "week"
  | "month"
  | "custom";

export type DashboardComparisonPeriod = {
  from: Date;
  to: Date;
  days: number;
  label: string;
  source: "manual" | "previous";
};

export type DashboardPeriod = {
  preset: DashboardPeriodPreset;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  comparison: DashboardComparisonPeriod;
  days: number;
  label: string;
};

export type DashboardFilters = {
  period: DashboardPeriod;
  trafficProviders: ConnectorProvider[];
  commerceProviders: ConnectorProvider[];
  comparisonEnabled: boolean;
};

type PeriodParams = Record<string, string | string[] | undefined>;

export const dashboardTrafficProviders = [
  ConnectorProvider.SHOPEE_ADS,
  ConnectorProvider.MERCADO_LIVRE_ADS,
  ConnectorProvider.META_ADS,
  ConnectorProvider.GOOGLE_ADS,
  ConnectorProvider.GA4,
] as const;

/**
 * Traffic/ad providers surfaced for dashboard aggregation. In marketplace-first
 * mode ALL paid-traffic/ad sources are hidden — the dashboard shows only
 * marketplace sales data (orders/revenue). The underlying
 * `dashboardTrafficProviders` tuple (and its label Record) stay intact, so the
 * behavior is reversible via the MARKETPLACE_FIRST flag.
 */
export const visibleTrafficProviders: ConnectorProvider[] = MARKETPLACE_FIRST
  ? []
  : [...dashboardTrafficProviders];

export const dashboardCommerceProviders = [
  ConnectorProvider.MERCADO_LIVRE,
  ConnectorProvider.SHOPEE,
  ConnectorProvider.SHOPIFY,
  ConnectorProvider.NUVEMSHOP,
  ConnectorProvider.TRAY,
  ConnectorProvider.WBUY,
  ConnectorProvider.ISET,
  ConnectorProvider.MAGAZORD,
  ConnectorProvider.GOOGLE_SHEETS,
  ConnectorProvider.LOJA_INTEGRADA,
] as const;

/**
 * Commerce providers surfaced for dashboard aggregation. In marketplace-first
 * mode only Shopee + Mercado Livre count — the other commerce platforms are
 * excluded so revenue/orders reflect those two marketplaces only. Reversible
 * via the MARKETPLACE_FIRST flag.
 */
export const visibleCommerceProviders: ConnectorProvider[] = MARKETPLACE_FIRST
  ? [...MARKETPLACE_PROVIDERS]
  : [...dashboardCommerceProviders];

export const dashboardTrafficProviderLabels: Record<
  (typeof dashboardTrafficProviders)[number],
  string
> = {
  [ConnectorProvider.SHOPEE_ADS]: "Shopee Ads",
  [ConnectorProvider.MERCADO_LIVRE_ADS]: "Mercado Livre Ads",
  [ConnectorProvider.META_ADS]: "Meta",
  [ConnectorProvider.GOOGLE_ADS]: "Google Ads",
  [ConnectorProvider.GA4]: "Google Analytics",
};

export const dashboardCommerceProviderLabels: Record<
  (typeof dashboardCommerceProviders)[number],
  string
> = {
  [ConnectorProvider.MERCADO_LIVRE]: "Mercado Livre",
  [ConnectorProvider.SHOPEE]: "Shopee",
  [ConnectorProvider.SHOPIFY]: "Shopify",
  [ConnectorProvider.NUVEMSHOP]: "Nuvemshop",
  [ConnectorProvider.TRAY]: "Tray",
  [ConnectorProvider.WBUY]: "WBuy",
  [ConnectorProvider.ISET]: "iSet",
  [ConnectorProvider.MAGAZORD]: "Magazord",
  [ConnectorProvider.GOOGLE_SHEETS]: "Google Sheets / WhatsApp",
  [ConnectorProvider.LOJA_INTEGRADA]: "Loja Integrada",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function diffDaysInclusive(from: Date, to: Date) {
  const diff = to.getTime() - from.getTime();
  return Math.max(Math.floor(diff / 86_400_000) + 1, 1);
}

function parseDateKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPeriod(
  preset: DashboardPeriodPreset,
  from: Date,
  to: Date,
): DashboardPeriod {
  const normalizedFrom = startOfUtcDay(from);
  const normalizedTo = startOfUtcDay(to);
  const days = diffDaysInclusive(normalizedFrom, normalizedTo);
  const previousTo = addDays(normalizedFrom, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  const comparison = buildComparisonPeriod(
    previousFrom,
    previousTo,
    "previous",
  );

  return {
    preset,
    from: normalizedFrom,
    to: normalizedTo,
    previousFrom,
    previousTo,
    comparison,
    days,
    label: `${dateFormatter.format(normalizedFrom)} - ${dateFormatter.format(normalizedTo)}`,
  };
}

function buildComparisonPeriod(
  from: Date,
  to: Date,
  source: DashboardComparisonPeriod["source"],
): DashboardComparisonPeriod {
  const normalizedFrom = startOfUtcDay(from);
  const normalizedTo = startOfUtcDay(to);

  return {
    from: normalizedFrom,
    to: normalizedTo,
    days: diffDaysInclusive(normalizedFrom, normalizedTo),
    label: `${dateFormatter.format(normalizedFrom)} - ${dateFormatter.format(normalizedTo)}`,
    source,
  };
}

function withManualComparison(
  period: DashboardPeriod,
  params: PeriodParams,
): DashboardPeriod {
  const compareFrom = parseDateKey(firstParam(params.compareFrom));
  const compareTo = parseDateKey(firstParam(params.compareTo));

  if (!compareFrom || !compareTo || compareFrom > compareTo) {
    return period;
  }

  const comparison = buildComparisonPeriod(compareFrom, compareTo, "manual");

  return {
    ...period,
    previousFrom: comparison.from,
    previousTo: comparison.to,
    comparison,
  };
}

function normalizePreset(
  value: string | undefined,
): DashboardPeriodPreset | "legacy_30d" | null {
  if (
    value === "day" ||
    value === "yesterday" ||
    value === "week" ||
    value === "month" ||
    value === "custom"
  ) {
    return value;
  }

  // Legacy "Tempo Real" preset was removed (its live-sync now runs for every
  // period); old bookmarked ?period=real_time URLs fall back to "Hoje".
  if (value === "real_time" || value === "today") {
    return "day";
  }

  if (value === "7d") {
    return "week";
  }

  if (value === "30d") {
    return "legacy_30d";
  }

  return null;
}

export function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function listDateKeys(from: Date, to: Date) {
  const keys: string[] = [];
  let cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);

  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return keys;
}

export function getDashboardPeriod(
  params: PeriodParams = {},
  now = new Date(),
): DashboardPeriod {
  const today = startOfUtcDay(now);
  const preset = normalizePreset(firstParam(params.period));
  let period: DashboardPeriod;

  if (preset === "day") {
    period = buildPeriod(preset, today, today);
    return withManualComparison(period, params);
  }

  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    period = buildPeriod("yesterday", yesterday, yesterday);
    return withManualComparison(period, params);
  }

  if (preset === "week") {
    // "7 Dias" = the 7 most recent COMPLETE days, ending yesterday. Today is a
    // partial day and is excluded so the window isn't skewed by an in-progress
    // (or empty) current day.
    period = buildPeriod("week", addDays(today, -7), addDays(today, -1));
    return withManualComparison(period, params);
  }

  if (preset === "month") {
    period = buildPeriod(
      "month",
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      today,
    );
    return withManualComparison(period, params);
  }

  if (preset === "legacy_30d") {
    period = buildPeriod("custom", addDays(today, -29), today);
    return withManualComparison(period, params);
  }

  if (preset === "custom") {
    const from = parseDateKey(firstParam(params.from));
    const to = parseDateKey(firstParam(params.to));

    if (from && to && from <= to) {
      period = buildPeriod("custom", from, to);
      return withManualComparison(period, params);
    }
  }

  period = buildPeriod(
    "month",
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    today,
  );
  return withManualComparison(period, params);
}

function splitProviderParam(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProviders<T extends ConnectorProvider>(
  value: string | string[] | undefined,
  allowed: readonly T[],
) {
  const selected = splitProviderParam(value).filter((provider): provider is T =>
    (allowed as readonly string[]).includes(provider),
  );

  return selected.length > 0 ? Array.from(new Set(selected)) : [...allowed];
}

export function getDashboardFilters(
  params: PeriodParams = {},
  now = new Date(),
): DashboardFilters {
  return {
    period: getDashboardPeriod(params, now),
    trafficProviders: parseProviders(params.traffic, visibleTrafficProviders),
    commerceProviders: parseProviders(
      params.commerce,
      visibleCommerceProviders,
    ),
    comparisonEnabled: false,
  };
}
