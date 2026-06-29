import { Download } from "lucide-react";

import { requestDataExportAction } from "@/app/(app)/profile/actions";
import { EventTracker } from "@/components/observability/event-tracker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { buildUserDataExport } from "@/lib/compliance/lgpd";

type DataExportPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DataExportPage({ searchParams }: DataExportPageProps) {
  const context = await getCurrentUserContext();
  const params = await searchParams;
  const payload = buildUserDataExport({
    user: {
      id: context.user.id,
      email: context.user.email,
      name: context.user.name,
    },
    workspaces: context.memberships.map((membership) => ({
      id: membership.workspaceId,
      name: membership.workspace.name,
      role: membership.role,
    })),
  });
  const json = JSON.stringify(payload, null, 2);
  const downloadHref = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {params.requested ? (
        <EventTracker
          name="data_export_request"
          userId={context.user.id}
          workspaceId={context.currentWorkspace.id}
        />
      ) : null}
      <section>
        <p className="text-caption text-[var(--text-tertiary)]">LGPD</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Exportação de dados</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Arquivo gerado com os dados da conta e vínculos de workspace disponíveis no app.
        </p>
      </section>

      {params.requested ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Solicitação registrada no audit log.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Arquivo JSON</CardTitle>
          <Download aria-hidden className="size-5 text-[var(--info)]" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <a download="adstart-w3-data-export.json" href={downloadHref}>
                Baixar JSON
              </a>
            </Button>
            <form action={requestDataExportAction}>
              <Button type="submit" variant="secondary">
                Registrar solicitação
              </Button>
            </form>
          </div>
          <pre className="max-h-[420px] overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-xs text-[var(--text-secondary)]">
            {json}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
