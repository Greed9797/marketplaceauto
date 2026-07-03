import { ConnectorStatus } from "@prisma/client";

import { humanizeConnectorSyncError } from "@/lib/connectors/humanize-sync-error";
import { prisma } from "@/lib/db/prisma";
import { humanizePublishError } from "@/lib/publisher/humanize-publish-error";

/**
 * Copiloto "bolinha" — Motor de Alterações no modo sugere→aprova (Onda 3).
 * Este módulo é o DIAGNÓSTICO: lê as superfícies de erro reais do workspace
 * (publicações que falharam, conectores com erro/expirados) e devolve, para
 * cada problema, uma lista de AÇÕES propostas. A execução é semi-autônoma: o
 * usuário clica "Aplicar" e o front dispara a MESMA rota de conserto que já
 * existe — nunca uma ação fora desta whitelist, nunca sem aprovação.
 */

/** Ação proposta. `post` executa uma rota de conserto; `link` leva a corrigir. */
export type CopilotAction =
  | { kind: "post"; endpoint: string; label: string }
  | { kind: "link"; href: string; label: string };

export type CopilotIssue = {
  id: string;
  severity: "error" | "warning";
  title: string;
  action: string;
  detail: string;
  actions: CopilotAction[];
};

const MAX_PER_SOURCE = 10;

/** Coleta os problemas do workspace e monta as propostas de conserto. */
export async function diagnoseWorkspace(
  workspaceId: string,
): Promise<CopilotIssue[]> {
  const [publicacoes, contas] = await Promise.all([
    prisma.publicacao.findMany({
      where: {
        status: "erro",
        produto: { cliente: { workspaceId } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_PER_SOURCE,
      select: {
        id: true,
        produtoId: true,
        plataforma: true,
        erroMensagem: true,
        produto: { select: { nomeOriginal: true } },
      },
    }),
    prisma.connectorAccount.findMany({
      where: {
        workspaceId,
        OR: [
          { status: { not: ConnectorStatus.ACTIVE } },
          { lastSyncError: { not: null } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_SOURCE,
      select: {
        id: true,
        provider: true,
        accountName: true,
        status: true,
        lastSyncError: true,
      },
    }),
  ]);

  const issues: CopilotIssue[] = [];

  for (const pub of publicacoes) {
    const friendly = humanizePublishError(pub.erroMensagem);
    const plataforma =
      pub.plataforma === "SHOPEE" ? "Shopee" : "Mercado Livre";
    issues.push({
      id: `pub:${pub.id}`,
      severity: "error",
      title: `${friendly.title} — ${pub.produto.nomeOriginal} (${plataforma})`,
      action: friendly.action,
      detail: friendly.detail,
      actions: [
        {
          kind: "post",
          endpoint: `/api/publicacoes/${pub.id}/retry`,
          label: "Tentar publicar de novo",
        },
        {
          kind: "link",
          href: `/produtos/${pub.produtoId}/otimizar`,
          label: "Abrir e corrigir",
        },
      ],
    });
  }

  for (const conta of contas) {
    const isActive = conta.status === ConnectorStatus.ACTIVE;
    const friendly = humanizeConnectorSyncError(
      conta.lastSyncError ?? `Conta com status ${conta.status}.`,
      conta.provider,
    );
    issues.push({
      id: `conn:${conta.id}`,
      severity: isActive ? "warning" : "error",
      title: `${friendly.title} — ${conta.accountName}`,
      action: friendly.action,
      detail: friendly.detail,
      actions: isActive
        ? [
            {
              kind: "post",
              endpoint: `/api/connectors/${conta.id}/sync`,
              label: "Sincronizar agora",
            },
          ]
        : [{ kind: "link", href: "/connectors", label: "Reconectar" }],
    });
  }

  // Erros primeiro, avisos depois.
  return issues.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );
}
