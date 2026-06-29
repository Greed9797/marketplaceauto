import Link from "next/link";
import { redirect } from "next/navigation";

import { createDashboardAction } from "@/app/(app)/dashboards/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HydratedSubmitButton } from "@/components/ui/hydrated-submit-button";
import { Input } from "@/components/ui/input";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canManagePlatformUsers } from "@/lib/auth/platform-permissions";
import { canEditDashboards } from "@/lib/auth/permissions";
import {
  dashboardWidgetCatalog,
  defaultWidgetIds,
} from "@/lib/metrics/kpi-catalog";

export default async function NewDashboardPage() {
  const context = await getCurrentUserContext();

  // Mirror createDashboardAction's gate (platform admin AND edit-dashboards).
  // Without the second check a VIEWER could render+submit the form and the
  // action would throw an uncaught error instead of redirecting.
  if (
    !canManagePlatformUsers(context.user) ||
    !canEditDashboards(context.currentMembership.role)
  ) {
    redirect("/dashboards");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Marcas</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Novo painel interno
        </h2>
      </div>

      <form action={createDashboardAction} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              label="Nome"
              name="name"
              placeholder="Performance paga"
              required
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Widgets iniciais</CardTitle>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Você pode adicionar, remover e ordenar depois.
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {dashboardWidgetCatalog.map((widget) => (
              <label
                className="flex gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)]"
                key={widget.id}
              >
                <input
                  className="mt-1 size-4 accent-[var(--w3-red)]"
                  defaultChecked={defaultWidgetIds.includes(widget.id)}
                  name="widgets"
                  type="checkbox"
                  value={widget.id}
                />
                <span>
                  <span className="block text-sm font-semibold">
                    {widget.label}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--text-secondary)]">
                    {widget.description}
                  </span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <HydratedSubmitButton>Criar dashboard</HydratedSubmitButton>
          <Button asChild type="button" variant="secondary">
            <Link href="/dashboards">Cancelar</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
