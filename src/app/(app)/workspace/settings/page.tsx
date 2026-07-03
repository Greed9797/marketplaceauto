import type { MemberRole } from "@prisma/client";

import {
  clearAiKeyAction,
  createWorkspaceAction,
  saveAiKeyAction,
  updateWorkspaceSettingsAction,
} from "@/app/(app)/actions";
import { hasWorkspaceAiKey } from "@/lib/publisher/ai-key";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCurrentUserContext } from "@/lib/auth/current";
import {
  canCreateWorkspace,
  canDeleteWorkspace,
  canManageWorkspaceSettings,
  getWorkspaceRoleDefinition,
} from "@/lib/auth/permissions";
import { isAdminMaster } from "@/lib/auth/platform-permissions";
import { WorkspaceRowActions } from "@/components/workspace/workspace-row-actions";
import { cn } from "@/lib/utils/cn";

type WorkspaceSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const pillBase =
  "inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap";

/** Tone of the workspace-role badge. */
function roleBadgeClass(role: MemberRole) {
  if (role === "OWNER") return "bg-[var(--w3-red-bg)] text-[var(--w3-red)]";
  if (role === "ADMIN") return "bg-[var(--info-bg)] text-[var(--info)]";
  if (role === "CLIENT") return "bg-[var(--warning-bg)] text-[var(--warning)]";
  return "bg-[var(--bg-elevated)] text-[var(--text-secondary)]";
}

function workspaceInitial(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export default async function WorkspaceSettingsPage({
  searchParams,
}: WorkspaceSettingsPageProps) {
  const context = await getCurrentUserContext();
  const params = await searchParams;
  const isMaster = isAdminMaster(context.user);
  const canEditWorkspace =
    isMaster || canManageWorkspaceSettings(context.currentMembership.role);
  const canCreateNewWorkspace = canCreateWorkspace(context.user);
  const aiKeyConfigured = await hasWorkspaceAiKey(context.currentWorkspace.id);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">
          Conta e workspaces
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Modelo Adstart de acesso
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
          Pessoas entram com uma conta pessoal, recebem um papel em cada
          workspace e os conectores, tokens e métricas ficam sempre vinculados
          ao workspace ativo.
        </p>
      </div>

      {params.saved ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Workspace atualizado.
        </p>
      ) : null}
      {params.created ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Novo workspace criado.
        </p>
      ) : null}
      {params.deleted ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Workspace excluído.
        </p>
      ) : null}
      {params.aikey === "saved" ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Chave de IA salva.
        </p>
      ) : params.aikey === "removed" ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Chave de IA removida.
        </p>
      ) : params.error === "invalid-aikey" ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          Informe uma chave de IA válida.
        </p>
      ) : null}
      {params.error === "confirm-mismatch" ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          O nome digitado não confere com o da marca. Exclusão cancelada.
        </p>
      ) : params.error === "last-workspace" ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          Você não pode excluir seu último workspace — ficaria sem acesso.
        </p>
      ) : params.error === "forbidden" ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          Seu papel não permite essa ação neste workspace.
        </p>
      ) : params.error ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          Não conseguimos salvar esses dados. Revise as informações e tente
          novamente.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Workspace atual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-caption text-[var(--text-tertiary)]">Nome</p>
                <p className="mt-1 font-medium">
                  {context.currentWorkspace.name}
                </p>
              </div>
              <div>
                <p className="text-caption text-[var(--text-tertiary)]">Slug</p>
                <p className="mt-1 font-mono text-sm">
                  {context.currentWorkspace.slug}
                </p>
              </div>
              <div>
                <p className="text-caption text-[var(--text-tertiary)]">
                  Seu papel
                </p>
                <span
                  className={cn(
                    pillBase,
                    "mt-1",
                    roleBadgeClass(context.currentMembership.role),
                  )}
                >
                  {
                    getWorkspaceRoleDefinition(context.currentMembership.role)
                      .label
                  }
                </span>
              </div>
            </div>

            {canEditWorkspace ? (
              <form
                action={updateWorkspaceSettingsAction}
                className="grid gap-4 md:grid-cols-[1fr_auto]"
              >
                <Input
                  defaultValue={context.currentWorkspace.name}
                  label="Nome do workspace"
                  name="name"
                  required
                />
                <Button className="self-end" type="submit" variant="secondary">
                  Salvar ajustes
                </Button>
              </form>
            ) : (
              <p className="rounded-md bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)]">
                Apenas Owner e Admin alteram os ajustes do workspace. Viewer e
                Cliente têm acesso somente leitura.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Criar workspace</CardTitle>
          </CardHeader>
          <CardContent>
            {canCreateNewWorkspace ? (
              <form action={createWorkspaceAction} className="space-y-4">
                <Input
                  label="Nome"
                  name="name"
                  placeholder="Loja da Maria"
                  required
                />
                <Button type="submit">Criar marca</Button>
              </form>
            ) : (
              <p className="rounded-md bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)]">
                Somente Admin Master e Admin Limitado podem criar novas marcas.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inteligência artificial (sua chave)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            Cadastre a sua chave do Google Gemini para gerar títulos, descrições,
            preencher a ficha técnica e criar imagens dos anúncios. A chave fica
            criptografada no cofre e nunca é exibida de volta. Pegue em{" "}
            <span className="font-mono">aistudio.google.com/apikey</span>.
          </p>
          {aiKeyConfigured ? (
            <p className="inline-flex items-center gap-2 rounded-md bg-[var(--success-bg)] px-3 py-1.5 text-sm text-[var(--success)]">
              Chave configurada ✓
            </p>
          ) : (
            <p className="inline-flex items-center gap-2 rounded-md bg-[var(--warning-bg)] px-3 py-1.5 text-sm text-[var(--warning)]">
              Nenhuma chave própria — usando a chave padrão do sistema (se houver).
            </p>
          )}
          {canEditWorkspace ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <form
                action={saveAiKeyAction}
                className="grid flex-1 gap-4 sm:grid-cols-[1fr_auto]"
              >
                <Input
                  label="Chave Gemini"
                  name="aiKey"
                  placeholder={aiKeyConfigured ? "•••••••• (substituir)" : "AIza..."}
                  required
                  type="password"
                />
                <Button className="self-end" type="submit" variant="secondary">
                  {aiKeyConfigured ? "Atualizar chave" : "Salvar chave"}
                </Button>
              </form>
              {aiKeyConfigured ? (
                <form action={clearAiKeyAction} className="self-end">
                  <Button type="submit" variant="ghost">
                    Remover
                  </Button>
                </form>
              ) : null}
            </div>
          ) : (
            <p className="rounded-md bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)]">
              Apenas Owner e Admin configuram a chave de IA.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Workspaces da sua conta</CardTitle>
          <span
            className={cn(
              pillBase,
              "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
            )}
          >
            {context.memberships.length}{" "}
            {context.memberships.length === 1 ? "workspace" : "workspaces"}
          </span>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-caption text-[var(--text-tertiary)]">
                <th className="px-5 py-3 font-medium">Workspace</th>
                <th className="px-5 py-3 font-medium">Seu papel</th>
                <th className="px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {context.memberships.map((membership) => {
                const role = getWorkspaceRoleDefinition(membership.role);
                const rowCanEdit =
                  isMaster || canManageWorkspaceSettings(membership.role);
                const rowCanDelete =
                  isMaster || canDeleteWorkspace(membership.role);
                const isCurrent =
                  membership.workspaceId === context.currentWorkspace.id;

                return (
                  <tr
                    className={cn(
                      "border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--bg-elevated)]/50",
                      isCurrent && "bg-[var(--bg-elevated)]/40",
                    )}
                    key={membership.id}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--w3-red-bg)] text-sm font-semibold text-[var(--w3-red)]"
                        >
                          {workspaceInitial(membership.workspace.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium text-[var(--text-primary)]">
                              {membership.workspace.name}
                            </p>
                            {isCurrent ? (
                              <span className="rounded-[var(--radius-pill)] bg-[var(--w3-red-bg)] px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--w3-red)]">
                                Atual
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate font-mono text-xs text-[var(--text-tertiary)]">
                            {membership.workspace.slug}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          pillBase,
                          roleBadgeClass(membership.role),
                        )}
                        title={role.description}
                      >
                        {role.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {rowCanEdit || rowCanDelete ? (
                        <WorkspaceRowActions
                          canDelete={rowCanDelete}
                          canEdit={rowCanEdit}
                          name={membership.workspace.name}
                          workspaceId={membership.workspaceId}
                        />
                      ) : (
                        <span className="block text-right text-[var(--text-tertiary)]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
