import { Timer, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";

import { deleteSessionAction } from "@/app/(app)/dashboards/timer-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canViewAccountTimerLogs } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDuration } from "@/lib/timer/duration";
import { listSessions } from "@/lib/timer/queries";

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDateTime(value: Date | null): string {
  return value ? dateTimeFmt.format(value) : "—";
}

export default async function TimerLogsPage() {
  const context = await getCurrentUserContext();

  // Authorize on the REAL membership role for the selected brand (never the
  // synthetic OWNER injected for internal admins).
  const realMembership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: {
        userId: context.user.id,
        workspaceId: context.currentWorkspace.id,
      },
    },
    select: { role: true },
  });
  if (!canViewAccountTimerLogs(context.user, realMembership?.role ?? null)) {
    redirect("/dashboards?error=forbidden");
  }

  const sessions = await listSessions(context.currentWorkspace.id);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-caption text-[var(--text-tertiary)]">
          Tempo de contas
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Passagem de conta — {context.currentWorkspace.name}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Quanto tempo cada gestor levou para fazer a análise desta marca.
          Troque de marca na barra lateral para ver outra.
        </p>
      </section>

      {sessions.length ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-tertiary)]">
                  <th className="px-5 py-3 font-medium">Gestor</th>
                  <th className="px-5 py-3 font-medium">Início</th>
                  <th className="px-5 py-3 font-medium">Fim</th>
                  <th className="px-5 py-3 font-medium">Duração</th>
                  <th className="px-5 py-3 font-medium">Nota</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="px-5 py-3 text-[var(--text-primary)]">
                      {session.user.name ?? session.user.email}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">
                      {formatDateTime(session.startedAt)}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">
                      {session.endedAt
                        ? formatDateTime(session.endedAt)
                        : "Em andamento"}
                    </td>
                    <td className="px-5 py-3 font-medium text-[var(--text-primary)]">
                      {session.durationSeconds != null
                        ? formatDuration(session.durationSeconds)
                        : "—"}
                    </td>
                    <td className="max-w-xs px-5 py-3 text-[var(--text-secondary)]">
                      {session.note ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <form action={deleteSessionAction}>
                        <input
                          name="sessionId"
                          type="hidden"
                          value={session.id}
                        />
                        <Button
                          aria-label="Excluir registro"
                          size="icon"
                          type="submit"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid min-h-64 place-items-center p-8 text-center">
            <div className="max-w-sm">
              <Timer
                aria-hidden
                className="mx-auto mb-4 size-8 text-[var(--w3-red)]"
              />
              <h3 className="text-lg font-semibold">
                Nenhuma passagem de conta registrada para esta marca.
              </h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Os registros aparecem aqui quando um gestor inicia e para o
                timer.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
