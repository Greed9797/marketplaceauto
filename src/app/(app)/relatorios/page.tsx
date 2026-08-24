import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import type { ConnectorProvider } from "@prisma/client";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { getRoasReport } from "@/lib/metrics/roas-report";
import {
  computeMarketplaceReport,
  saoPauloToday,
} from "@/lib/reports/marketplace-report";

import { RelatorioClient } from "./relatorio-client";
import { RoasReportCard } from "./roas-report-card";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROAS_WINDOW_RE = /^(7|30|90)$/;
const SOURCE_RE = /^(SHOPEE_ADS|MERCADO_LIVRE_ADS)$/;

type RelatoriosPageProps = {
  searchParams: Promise<{ date?: string; janela?: string; fonte?: string }>;
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

  const { date, janela, fonte } = await searchParams;
  const referenceDate = date && DATE_RE.test(date) ? date : saoPauloToday();
  const windowDays =
    janela && ROAS_WINDOW_RE.test(janela) ? Number(janela) : 30;
  const source: ConnectorProvider | null =
    fonte && SOURCE_RE.test(fonte) ? (fonte as ConnectorProvider) : null;

  const report = await computeMarketplaceReport({
    workspaceId: context.currentWorkspace.id,
    referenceDate,
  });

  const roasReport = await getRoasReport({
    workspaceId: context.currentWorkspace.id,
    windowDays,
    source,
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Consolidado</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Relatórios
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Desempenho de ROAS por janela e o resumo diário para colar no
          WhatsApp.
        </p>
      </div>

      <Card>
        <CardContent>
          <RoasReportCard report={roasReport} referenceDate={referenceDate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <RelatorioClient report={report} />
        </CardContent>
      </Card>
    </div>
  );
}
