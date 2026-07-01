import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import {
  computeMarketplaceReport,
  saoPauloToday,
} from "@/lib/reports/marketplace-report";

import { RelatorioClient } from "./relatorio-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RelatoriosPageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function RelatoriosPage({
  searchParams,
}: RelatoriosPageProps) {
  const context = await getCurrentUserContext();
  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    redirect("/dashboard");
  }

  const { date } = await searchParams;
  const referenceDate = date && DATE_RE.test(date) ? date : saoPauloToday();

  const report = await computeMarketplaceReport({
    workspaceId: context.currentWorkspace.id,
    referenceDate,
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Consolidado</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Relatórios
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Gere o resumo diário para colar no WhatsApp. Escolha a data, ajuste os
          campos manuais e copie.
        </p>
      </div>

      <Card>
        <CardContent>
          <RelatorioClient report={report} />
        </CardContent>
      </Card>
    </div>
  );
}
