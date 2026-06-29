import { ArrowLeft, Cable } from "lucide-react";
import Link from "next/link";

import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { getConnectorDefinition } from "@/lib/connectors/registry";
import { parseSelectableAccounts } from "@/lib/connectors/selection";
import { prisma } from "@/lib/db/prisma";

type ConnectorSelectPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConnectorSelectPage({
  searchParams,
}: ConnectorSelectPageProps) {
  const context = await getCurrentUserContext();
  const params = await searchParams;
  const sessionId = firstParam(params.session);

  if (!sessionId) {
    return (
      <div className="space-y-4">
        <Button asChild variant="secondary">
          <Link href="/connectors">
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar
          </Link>
        </Button>
        <Card>
          <CardContent className="p-6 text-sm text-[var(--text-secondary)]">
            Sessao de selecao indisponivel.
          </CardContent>
        </Card>
      </div>
    );
  }

  // The selection row carries the authoritative target workspace (signed into
  // the OAuth state at connect time). Do NOT scope by the request cookie — it
  // is dropped on the cross-site OAuth return and would point at the agency's
  // default workspace, hiding a session that targets a client workspace.
  const selection = await prisma.connectorSelectionSession.findFirst({
    where: {
      id: sessionId,
      userId: context.user.id,
      status: "PENDING",
    },
  });
  const rawAccess = selection
    ? await resolveConnectorWorkspaceAccess({
        userId: context.user.id,
        workspaceId: selection.workspaceId,
      })
    : null;
  // Mirror the POST gate in /api/connectors/select so the UI never renders a
  // selection the user can't actually submit.
  const access =
    rawAccess && canOperateWorkspaceConnectors(rawAccess.user, rawAccess.role)
      ? rawAccess
      : null;
  const accounts = parseSelectableAccounts(selection?.accounts);
  const definition =
    selection && access ? getConnectorDefinition(selection.provider) : null;

  if (
    !selection ||
    !access ||
    selection.expiresAt.getTime() < Date.now() ||
    !definition
  ) {
    return (
      <div className="space-y-4">
        <Button asChild variant="secondary">
          <Link href="/connectors">
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar
          </Link>
        </Button>
        <Card>
          <CardContent className="p-6 text-sm text-[var(--text-secondary)]">
            Essa sessao expirou. Inicie a conexao novamente.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="secondary">
        <Link href="/connectors">
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar
        </Link>
      </Button>

      <div>
        <p className="text-caption text-[var(--text-tertiary)]">
          Selecionar conta
        </p>
        <div className="mt-2 flex items-center gap-3">
          <ProviderLogo provider={definition.provider} />
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">
            {definition.name}
          </h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          Vincule somente a {definition.accountUnitLabel.toLowerCase()} do
          cliente.
          {definition.provider === "GA4"
            ? " Contas do Analytics servem apenas como origem de permissao."
            : " BMs e MCCs servem apenas como origem de permissao."}
        </p>
      </div>

      <form action="/api/connectors/select" method="post">
        <input name="sessionId" type="hidden" value={selection.id} />
        <Card>
          <CardHeader>
            <CardTitle>Contas encontradas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {accounts.map((account) => (
              <label
                className="flex items-center justify-between gap-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm hover:bg-[var(--bg-elevated)]"
                key={account.externalAccountId}
              >
                <span>
                  <span className="block font-semibold text-[var(--text-primary)]">
                    {account.accountName}
                  </span>
                  <span className="font-mono text-xs text-[var(--text-tertiary)]">
                    {account.externalAccountId}
                  </span>
                </span>
                <input
                  className="h-4 w-4 accent-[var(--w3-red)]"
                  name="externalAccountId"
                  type="checkbox"
                  value={account.externalAccountId}
                />
              </label>
            ))}

            <Button className="mt-4" type="submit">
              <Cable size={16} aria-hidden="true" />
              Vincular selecionadas
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
