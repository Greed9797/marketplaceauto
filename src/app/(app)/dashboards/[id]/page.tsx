import { Star } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  DashboardWidgetRenderer,
  WidgetCatalogList,
} from "@/components/dashboards/dashboard-widget-renderer";
import { PeriodPicker } from "@/components/dashboards/period-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canEditDashboards } from "@/lib/auth/permissions";
import {
  canManagePlatformUsers,
  canViewBrands,
} from "@/lib/auth/platform-permissions";
import { parseDashboardWidgets } from "@/lib/dashboards/store";
import { prisma } from "@/lib/db/prisma";
import { getDashboardSnapshot } from "@/lib/metrics/aggregator";
import { getDashboardPeriod } from "@/lib/metrics/period";

type DashboardDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardDetailPage({
  params,
  searchParams,
}: DashboardDetailPageProps) {
  const context = await getCurrentUserContext();

  if (!canViewBrands(context.user)) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const query = await searchParams;
  const dashboard = await prisma.dashboard.findFirst({
    where: {
      id,
      workspaceId: context.currentWorkspace.id,
    },
  });

  if (!dashboard) {
    redirect("/dashboards");
  }

  const period = getDashboardPeriod(query);
  const snapshot = await getDashboardSnapshot({
    workspaceId: context.currentWorkspace.id,
    period,
  });
  const widgets = parseDashboardWidgets(dashboard.widgets);
  const canEdit =
    canManagePlatformUsers(context.user) &&
    canEditDashboards(context.currentMembership.role);
  const canEditThisDashboard = canEdit;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">
            Dashboard customizado
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">
              {dashboard.name}
            </h2>
            {dashboard.isDefault ? (
              <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--w3-gold-bg)] px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--w3-gold)]">
                <Star aria-hidden className="size-3" />
                Padrão
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Período: {period.label}. Ordem vertical por slots, sem
            drag-and-drop.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/dashboards">Todos os dashboards</Link>
        </Button>
      </section>

      {query.created ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Dashboard criado.
        </p>
      ) : null}
      {query.updated ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Layout atualizado.
        </p>
      ) : null}

      <PeriodPicker period={period} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <DashboardWidgetRenderer
          canEdit={canEditThisDashboard}
          dashboardId={dashboard.id}
          snapshot={snapshot}
          widgets={widgets}
        />

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Biblioteca</CardTitle>
            </CardHeader>
            <CardContent>
              {canEditThisDashboard ? (
                <WidgetCatalogList dashboardId={dashboard.id} />
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">
                  Viewers podem consultar dashboards, mas não alterar widgets.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
