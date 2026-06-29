import { AlertTriangle } from "lucide-react";

import { requestDeleteAccountAction } from "@/app/(app)/profile/actions";
import { EventTracker } from "@/components/observability/event-tracker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HydratedSubmitButton } from "@/components/ui/hydrated-submit-button";
import { Input } from "@/components/ui/input";
import { getCurrentUserContext } from "@/lib/auth/current";

type DeleteAccountPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DeleteAccountPage({ searchParams }: DeleteAccountPageProps) {
  const context = await getCurrentUserContext();
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {params.requested ? (
        <EventTracker
          name="delete_account_request"
          userId={context.user.id}
          workspaceId={context.currentWorkspace.id}
        />
      ) : null}
      <section>
        <p className="text-caption text-[var(--text-tertiary)]">LGPD</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Excluir conta</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Confirme com seu email para registrar a solicitação de exclusão.
        </p>
      </section>

      {params.error === "confirmation" ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          O email digitado não confere com a conta atual.
        </p>
      ) : null}
      {params.requested ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Solicitação registrada. Em produção, a conta fica marcada para purge.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Confirmação</CardTitle>
          <AlertTriangle aria-hidden className="size-5 text-[var(--danger)]" />
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            Esta ação marca a conta para exclusão e encerra sessões no ambiente com banco real.
            Digite <span className="font-mono text-[var(--text-primary)]">{context.user.email}</span>{" "}
            para confirmar.
          </p>
          <form action={requestDeleteAccountAction} className="space-y-4">
            <Input label="Email de confirmação" name="emailConfirmation" type="email" required />
            <HydratedSubmitButton variant="destructive">
              Confirmar exclusão
            </HydratedSubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
