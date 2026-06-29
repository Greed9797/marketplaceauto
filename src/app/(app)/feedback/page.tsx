import { MessageSquareText } from "lucide-react";

import { submitFeedbackAction } from "@/app/(app)/feedback/actions";
import { EventTracker } from "@/components/observability/event-tracker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HydratedSubmitButton } from "@/components/ui/hydrated-submit-button";
import { getCurrentUserContext } from "@/lib/auth/current";
import { feedbackTypes, normalizeFeedbackPagePath } from "@/lib/feedback/schema";

type FeedbackPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function feedbackTypeLabel(type: (typeof feedbackTypes)[number]) {
  const labels = {
    BUG: "Problema",
    SUGGESTION: "Sugestão",
    QUESTION: "Dúvida",
  };

  return labels[type];
}

export default async function FeedbackPage({ searchParams }: FeedbackPageProps) {
  const context = await getCurrentUserContext();
  const params = await searchParams;
  const pagePath = normalizeFeedbackPagePath(firstParam(params.from)) ?? "/feedback";
  const hasInvalidError = firstParam(params.error) === "invalid";
  const wasSent = firstParam(params.sent) === "1";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {wasSent ? (
        <EventTracker
          name="feedback_submit"
          properties={{ pagePath }}
          userId={context.user.id}
          workspaceId={context.currentWorkspace.id}
        />
      ) : null}
      <section>
        <p className="text-caption text-[var(--text-tertiary)]">Beta fechado</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Enviar feedback</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Reporte problemas, dúvidas ou sugestões do beta. Vamos usar isso para priorizar os
          próximos ajustes antes das contas reais.
        </p>
      </section>

      {wasSent ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Feedback recebido. Obrigado por ajudar a lapidar o beta.
        </p>
      ) : null}

      {hasInvalidError ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          Escreva uma mensagem com pelo menos 10 caracteres para enviar.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Detalhes</CardTitle>
          <MessageSquareText aria-hidden className="size-5 text-[var(--w3-red)]" />
        </CardHeader>
        <CardContent>
          <form action={submitFeedbackAction} className="space-y-5">
            <input name="pagePath" type="hidden" value={pagePath} />

            <label className="grid gap-2 text-[var(--text-primary)]">
              <span className="text-caption text-[var(--text-tertiary)]">Tipo</span>
              <select
                className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]"
                defaultValue="SUGGESTION"
                name="type"
              >
                {feedbackTypes.map((type) => (
                  <option key={type} value={type}>
                    {feedbackTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-[var(--text-primary)]">
              <span className="text-caption text-[var(--text-tertiary)]">Mensagem</span>
              <textarea
                className="min-h-36 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm leading-6 text-[var(--text-primary)] outline-none transition duration-200 placeholder:text-[var(--text-tertiary)] focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]"
                maxLength={2000}
                name="message"
                placeholder="Conte o que aconteceu ou o que melhoraria sua rotina."
                required
              />
            </label>

            <HydratedSubmitButton>Enviar feedback</HydratedSubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
