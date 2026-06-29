import {
  ArrowUpRight,
  BarChart3,
  BadgePercent,
  CircleDollarSign,
  Plus,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ConnectorProvider } from "@prisma/client";

import { switchWorkspaceAction } from "@/app/(app)/actions";
import { DashboardFilterBar } from "@/components/dashboards/dashboard-filter-bar";
import {
  GoogleAdsLogo,
  MetaAdsLogo,
} from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canUseAccountTimer } from "@/lib/auth/permissions";
import {
  canManagePlatformUsers,
  canViewBrands,
} from "@/lib/auth/platform-permissions";
import { getActiveSession } from "@/lib/timer/queries";
import { TimerControl } from "@/components/timer/timer-control";
import { BrandTimerButton } from "@/components/timer/brand-timer-button";
import { prisma } from "@/lib/db/prisma";
import {
  calculateRatioPercent,
  calculateRoas,
  isApprovedOrderStatus,
} from "@/lib/metrics/aggregator";
import {
  dashboardTrafficProviders,
  getDashboardFilters,
  getDashboardPeriod,
} from "@/lib/metrics/period";
import {
  formatCurrencyBR,
  formatPercentBR,
  formatRoasBR,
} from "@/lib/utils/format-br";
import { DashboardAutoRefresh } from "@/components/dashboard/dashboard-auto-refresh";

type DashboardsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type BrandRow = {
  workspaceId: string;
  name: string;
  slug: string;
  revenue: number;
  spend: number;
  mediaRate: number;
  roas: number;
  metaRoas: number;
  googleRoas: number;
};

function sum(
  items: BrandRow[],
  key: keyof Pick<BrandRow, "revenue" | "spend">,
) {
  return items.reduce((total, item) => total + item[key], 0);
}

function summarizeBrands(brands: BrandRow[]) {
  const revenue = sum(brands, "revenue");
  const spend = sum(brands, "spend");

  return {
    revenue,
    spend,
    mediaRate: calculateRatioPercent(spend, revenue),
    roas: calculateRoas(revenue, spend),
  };
}

function formatSlug(slug: string) {
  return slug ? `${slug}.w3ads` : "marca-sem-slug.w3ads";
}

function metricValue(value: number, kind: "currency" | "percent" | "roas") {
  if (kind === "currency") return formatCurrencyBR(value);
  if (kind === "percent") return formatPercentBR(value);
  return formatRoasBR(value);
}

function SummaryCard({
  label,
  kind,
  value,
}: {
  label: string;
  kind: "currency" | "percent" | "roas";
  value: number;
}) {
  return (
    <Card className="min-h-[132px]">
      <CardHeader className="mb-3">
        <CardTitle className="metric-label">{label}</CardTitle>
        <span className="size-2 rounded-full bg-[var(--w3-red)] shadow-[0_0_0_4px_var(--w3-red-bg)]" />
      </CardHeader>
      <CardContent>
        <p className="font-[var(--font-display)] text-[2rem] leading-none tracking-[-0.03em] text-[var(--metric-value)]">
          {metricValue(value, kind)}
        </p>
      </CardContent>
    </Card>
  );
}

function BrandMetric({
  icon,
  kind,
  label,
  value,
}: {
  icon: ReactNode;
  kind: "currency" | "percent" | "roas";
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="metric-label mb-1 flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-[var(--bg-surface)] text-[var(--w3-red)]">
          {icon}
        </span>
        {label}
      </div>
      <p className="font-[var(--font-display)] text-[1.65rem] leading-none tracking-[-0.03em] text-[var(--metric-value)]">
        {metricValue(value, kind)}
      </p>
    </div>
  );
}

function BrandCard({
  brand,
  showTimer,
  activeStartedAt,
}: {
  brand: BrandRow;
  showTimer: boolean;
  activeStartedAt: string | null;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="p-6">
        <div className="mb-6">
          <Tag aria-hidden className="size-5 text-[var(--text-tertiary)]" />
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-2xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              {brand.name}
            </h3>
            <p className="mt-1 truncate text-sm text-[var(--text-secondary)]">
              {formatSlug(brand.slug)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <form action={switchWorkspaceAction}>
              <input
                name="workspaceId"
                type="hidden"
                value={brand.workspaceId}
              />
              <Button size="sm" type="submit" variant="secondary">
                Dashboard
                <ArrowUpRight aria-hidden className="size-4" />
              </Button>
            </form>
            {showTimer ? (
              <BrandTimerButton
                activeStartedAt={activeStartedAt}
                workspaceId={brand.workspaceId}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 p-6 md:grid-cols-2">
        <BrandMetric
          icon={<CircleDollarSign aria-hidden className="size-3.5" />}
          kind="currency"
          label="Faturamento"
          value={brand.revenue}
        />
        <BrandMetric
          icon={<BarChart3 aria-hidden className="size-3.5" />}
          kind="currency"
          label="Total investido"
          value={brand.spend}
        />
        <BrandMetric
          icon={<ArrowUpRight aria-hidden className="size-3.5" />}
          kind="roas"
          label="ROAS Global"
          value={brand.roas}
        />
        <BrandMetric
          icon={<BadgePercent aria-hidden className="size-3.5" />}
          kind="percent"
          label="% de mídia"
          value={brand.mediaRate}
        />
        <BrandMetric
          icon={<MetaAdsLogo className="size-5 rounded-[6px] shadow-none" />}
          kind="roas"
          label="Facebook ROAS"
          value={brand.metaRoas}
        />
        <BrandMetric
          icon={<GoogleAdsLogo className="size-5 shadow-none" />}
          kind="roas"
          label="Conversão/custo"
          value={brand.googleRoas}
        />
      </div>
    </Card>
  );
}

async function getRealBrands(from: Date, to: Date): Promise<BrandRow[]> {
  // `to` is start-of-UTC-day (today at 00:00). Use an exclusive upper bound one
  // day later so the FULL current day is included — matching the per-workspace
  // dashboard (which uses dayAfter(to)). A bare `lte: to` dropped today's
  // orders and made the Marcas card diverge from the brand dashboard.
  const toExclusive = new Date(to);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  // Fetch the workspace set FIRST, then scope the order/metric reads by
  // `workspaceId IN (...)`. Same result (this view aggregates every workspace),
  // but the scoped queries hit the composite indexes ([workspaceId, placedAt] /
  // [workspaceId, source, date]) instead of a cross-tenant full-table scan on
  // the shared Postgres.
  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });
  const workspaceIds = workspaces.map((workspace) => workspace.id);

  const [orders, metrics] = await Promise.all([
    prisma.ecommerceOrder.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        placedAt: {
          gte: from,
          lt: toExclusive,
        },
      },
      select: {
        workspaceId: true,
        orderTotal: true,
        status: true,
        platform: true,
      },
    }),
    prisma.dailyMetric.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        date: {
          gte: from,
          lt: toExclusive,
        },
        // Spend/ROAS only from traffic providers — same contract as the
        // per-workspace dashboard. Without this, a future ad connector writing
        // a new source would diverge the blended ROAS between the two views.
        source: { in: [...dashboardTrafficProviders] },
      },
      select: {
        workspaceId: true,
        source: true,
        spend: true,
        conversionsValue: true,
      },
    }),
  ]);

  const rows = new Map<string, BrandRow>();

  for (const workspace of workspaces) {
    rows.set(workspace.id, {
      workspaceId: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      revenue: 0,
      spend: 0,
      mediaRate: 0,
      roas: 0,
      metaRoas: 0,
      googleRoas: 0,
    });
  }

  for (const order of orders) {
    const row = rows.get(order.workspaceId);
    // Count ONLY approved sales, identical to the per-workspace dashboard
    // (buildDashboardSnapshot). Without this the Marcas card summed every
    // order (incl. pending/cancelled) and diverged from the brand's own
    // dashboard faturamento.
    if (row && isApprovedOrderStatus(order.status, order.platform)) {
      row.revenue += Number(order.orderTotal);
    }
  }

  const providerTotals = new Map<
    string,
    {
      metaSpend: number;
      metaValue: number;
      googleSpend: number;
      googleValue: number;
    }
  >();

  for (const metric of metrics) {
    const row = rows.get(metric.workspaceId);
    if (!row) continue;

    const spend = Number(metric.spend ?? 0);
    const conversionsValue = Number(metric.conversionsValue ?? 0);
    row.spend += spend;

    const provider = providerTotals.get(metric.workspaceId) ?? {
      metaSpend: 0,
      metaValue: 0,
      googleSpend: 0,
      googleValue: 0,
    };

    if (metric.source === ConnectorProvider.META_ADS) {
      provider.metaSpend += spend;
      provider.metaValue += conversionsValue;
    }

    if (metric.source === ConnectorProvider.GOOGLE_ADS) {
      provider.googleSpend += spend;
      provider.googleValue += conversionsValue;
    }

    providerTotals.set(metric.workspaceId, provider);
  }

  return Array.from(rows.values())
    .map((row) => {
      const provider = providerTotals.get(row.workspaceId);

      return {
        ...row,
        revenue: Number(row.revenue.toFixed(2)),
        spend: Number(row.spend.toFixed(2)),
        mediaRate: calculateRatioPercent(row.spend, row.revenue),
        roas: calculateRoas(row.revenue, row.spend),
        metaRoas: calculateRoas(
          provider?.metaValue ?? 0,
          provider?.metaSpend ?? 0,
        ),
        googleRoas: calculateRoas(
          provider?.googleValue ?? 0,
          provider?.googleSpend ?? 0,
        ),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

const BRANDS_PER_PAGE = 20;

function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildPageHref(
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return qs ? `/dashboards?${qs}` : "/dashboards";
}

export default async function DashboardsPage({
  searchParams,
}: DashboardsPageProps) {
  const context = await getCurrentUserContext();

  if (!canViewBrands(context.user)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const period = getDashboardPeriod(params);
  const filters = getDashboardFilters(params);
  const brands = await getRealBrands(period.from, period.to);
  const totals = summarizeBrands(brands);

  // Account-handover timer — only internal W3 managers see it. Bound to the
  // currently-selected brand; the active session (if any) is the server source
  // of truth so the count survives reloads.
  const showTimer = canUseAccountTimer(context.user);
  const activeSession = showTimer
    ? await getActiveSession(context.user.id)
    : null;
  const activeStartedAtIso = activeSession
    ? activeSession.startedAt.toISOString()
    : null;
  const timerError = Array.isArray(params.timerError)
    ? params.timerError[0]
    : params.timerError;

  // Baseline for the auto-refresh poller: when the layout `after()` background
  // sync advances lastSyncedAt past this, the client calls router.refresh().
  const syncState = await prisma.workspaceSyncState.findUnique({
    where: { workspaceId: context.currentWorkspace.id },
    select: { lastSyncedAt: true },
  });

  // Paginate: 20 brands per page, page 2 holds the next 20, and so on. Totals
  // above still reflect ALL brands, not just the current page.
  const totalPages = Math.max(1, Math.ceil(brands.length / BRANDS_PER_PAGE));
  const currentPage = Math.min(parsePage(params.page), totalPages);
  const pageStart = (currentPage - 1) * BRANDS_PER_PAGE;
  const pageBrands = brands.slice(pageStart, pageStart + BRANDS_PER_PAGE);

  return (
    <div className="space-y-6">
      <DashboardAutoRefresh
        initialSyncedAt={syncState?.lastSyncedAt?.toISOString() ?? null}
      />
      {showTimer ? (
        <>
          {timerError ? (
            <p className="rounded-md border border-[var(--danger)] bg-[var(--w3-red-bg)] px-4 py-2 text-sm text-[var(--danger)]">
              {timerError === "active"
                ? "Você já tem um timer em andamento. Pare-o antes de iniciar outro."
                : timerError === "forbidden"
                  ? "Sem permissão para usar o timer."
                  : "Não foi possível atualizar o timer."}
            </p>
          ) : null}
          {activeSession ? (
            <TimerControl
              activeSession={{
                id: activeSession.id,
                startedAt: activeSession.startedAt.toISOString(),
                brandName: activeSession.workspaceName,
              }}
            />
          ) : null}
        </>
      ) : null}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Marcas</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Central de marcas
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Visão interna do Admin Master por marca, faturamento e mídia no
            período atual.
          </p>
        </div>
        {canManagePlatformUsers(context.user) ? (
          <Button asChild>
            <Link href="/workspace/settings">
              <Plus aria-hidden className="size-4" />
              Nova marca
            </Link>
          </Button>
        ) : null}
      </section>

      <DashboardFilterBar
        actionPath="/dashboards"
        filters={filters}
        showProviderFilters={false}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          kind="currency"
          label="Total faturado"
          value={totals.revenue}
        />
        <SummaryCard
          kind="currency"
          label="Total investido"
          value={totals.spend}
        />
        <SummaryCard
          kind="percent"
          label="% de mídia"
          value={totals.mediaRate}
        />
        <SummaryCard kind="roas" label="ROAS Global" value={totals.roas} />
      </section>

      {brands.length ? (
        <>
          <section className="grid gap-4 xl:grid-cols-3">
            {pageBrands.map((brand) => (
              <BrandCard
                activeStartedAt={
                  activeSession?.workspaceId === brand.workspaceId
                    ? activeStartedAtIso
                    : null
                }
                brand={brand}
                key={`${brand.workspaceId}-${brand.slug}`}
                showTimer={showTimer}
              />
            ))}
          </section>

          {totalPages > 1 ? (
            <nav
              aria-label="Paginação de marcas"
              className="flex items-center justify-between gap-4 pt-2"
            >
              <p className="text-sm text-[var(--text-secondary)]">
                Mostrando {pageStart + 1}–{pageStart + pageBrands.length} de{" "}
                {brands.length} marcas
              </p>
              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      href={buildPageHref(params, currentPage - 1)}
                      aria-label="Página anterior"
                    >
                      Anterior
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    Anterior
                  </Button>
                )}
                <span className="text-sm text-[var(--text-tertiary)]">
                  Página {currentPage} de {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      href={buildPageHref(params, currentPage + 1)}
                      aria-label="Próxima página"
                    >
                      Próxima
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    Próxima
                  </Button>
                )}
              </div>
            </nav>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="grid min-h-64 place-items-center p-8 text-center">
            <div className="max-w-sm">
              <Tag
                aria-hidden
                className="mx-auto mb-4 size-8 text-[var(--w3-red)]"
              />
              <h3 className="text-lg font-semibold">
                Nenhuma marca com dados no período.
              </h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Conecte contas e lojas aos workspaces para alimentar esta visão.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
