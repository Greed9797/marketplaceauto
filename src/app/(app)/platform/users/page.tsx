import type { PlatformRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { createPlatformUserAction } from "@/app/(app)/platform/users/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCurrentUserContext } from "@/lib/auth/current";
import {
  canManageAdminUsers,
  canManagePlatformUsers,
  platformRoleLabel,
} from "@/lib/auth/platform-permissions";
import { getWorkspaceRoleDefinition } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils/cn";

type PlatformUsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const errorMessages: Record<string, string> = {
  invalid: "Revise os campos e tente novamente.",
  role: "Seu papel não permite criar esse tipo de usuário.",
  workspace: "Selecione um workspace para criar cliente.",
  email: "Esse email já existe.",
};

const pillBase =
  "inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap";

/** Tone of the platform-role badge: internal admins stand out in red. */
function roleBadgeClass(role: PlatformRole) {
  if (role === "ADMIN_MASTER" || role === "W3_ADMIN") {
    return "bg-[var(--w3-red-bg)] text-[var(--w3-red)]";
  }
  if (role === "ADMIN_LIMITED") {
    return "bg-[var(--info-bg)] text-[var(--info)]";
  }
  if (role === "TRAFFIC_MANAGER") {
    return "bg-[var(--warning-bg)] text-[var(--warning)]";
  }
  return "bg-[var(--bg-elevated)] text-[var(--text-secondary)]";
}

/** Initial for the avatar — name first, email fallback. */
function avatarInitial(name: string | null, email: string) {
  const source = name?.trim() || email;
  return source.charAt(0).toUpperCase();
}

const WORKSPACE_CHIPS_SHOWN = 3;

export default async function PlatformUsersPage({
  searchParams,
}: PlatformUsersPageProps) {
  const context = await getCurrentUserContext();
  if (!canManagePlatformUsers(context.user)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const error = firstParam(params.error);
  const created = firstParam(params.created);
  const canCreateAdmins = canManageAdminUsers(context.user);
  const roleOptions = [
    ...(canCreateAdmins
      ? [
          { value: "ADMIN_MASTER", label: "Admin Master" },
          { value: "ADMIN_LIMITED", label: "Admin Limitado" },
        ]
      : []),
    { value: "TRAFFIC_MANAGER", label: "Gestor de Tráfego" },
    { value: "USER", label: "Cliente" },
  ];

  const [users, workspaces] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        createdAt: true,
        memberships: {
          include: {
            workspace: {
              select: { id: true, name: true },
            },
          },
        },
      },
    }),
    prisma.workspace.findMany({
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Plataforma</p>
          <div className="mt-2 flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">
              Usuários
            </h2>
            <span
              className={cn(
                pillBase,
                "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
              )}
            >
              {users.length} {users.length === 1 ? "acesso" : "acessos"}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
            Crie acessos internos W3 e clientes read-only vinculados a uma
            marca.
          </p>
        </div>
      </section>

      {created ? (
        <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Usuário criado com acesso real.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
          {errorMessages[error] ?? "Não conseguimos criar o usuário."}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Novo usuário</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={createPlatformUserAction}
            className="grid gap-4 lg:grid-cols-4"
          >
            <Input label="Nome" name="name" required />
            <Input label="Email" name="email" type="email" required />
            <Input
              label="Senha temporária"
              name="password"
              type="password"
              required
            />
            <label className="grid gap-2">
              <span className="text-caption text-[var(--text-tertiary)]">
                Papel
              </span>
              <select
                className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm"
                name="platformRole"
                defaultValue="USER"
              >
                {roleOptions.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 lg:col-span-3">
              <span className="text-caption text-[var(--text-tertiary)]">
                Workspace do cliente
              </span>
              <select
                className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm"
                name="workspaceId"
                defaultValue={context.currentWorkspace.id}
              >
                <option value="">Sem workspace para usuário interno</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-[var(--text-tertiary)]">
                Aplica-se a Clientes. Usuários internos W3 ficam sem workspace.
              </span>
              <input name="membershipRole" type="hidden" value="CLIENT" />
            </label>
            <Button className="self-end" type="submit">
              Criar usuário
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuários atuais</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-caption text-[var(--text-tertiary)]">
                <th className="px-5 py-3 font-medium">Usuário</th>
                <th className="px-5 py-3 font-medium">Papel W3</th>
                <th className="px-5 py-3 font-medium">Workspaces</th>
                <th className="px-5 py-3 text-right font-medium">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const extraWorkspaces =
                  user.memberships.length - WORKSPACE_CHIPS_SHOWN;

                return (
                  <tr
                    className="border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--bg-elevated)]/50"
                    key={user.id}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--w3-red-bg)] text-sm font-semibold text-[var(--w3-red)]"
                        >
                          {avatarInitial(user.name, user.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--text-primary)]">
                            {user.name ?? "Sem nome"}
                          </p>
                          <p className="truncate text-xs text-[var(--text-secondary)]">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          pillBase,
                          roleBadgeClass(user.platformRole),
                        )}
                      >
                        {platformRoleLabel(user.platformRole)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {user.memberships.length ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {user.memberships
                            .slice(0, WORKSPACE_CHIPS_SHOWN)
                            .map((membership) => (
                              <span
                                className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs"
                                key={membership.id}
                              >
                                <span className="font-medium text-[var(--text-primary)]">
                                  {membership.workspace.name}
                                </span>
                                <span className="text-[var(--text-tertiary)]">
                                  {
                                    getWorkspaceRoleDefinition(membership.role)
                                      .label
                                  }
                                </span>
                              </span>
                            ))}
                          {extraWorkspaces > 0 ? (
                            <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                              +{extraWorkspaces}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span
                          className={cn(
                            pillBase,
                            "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]",
                          )}
                        >
                          Interno W3
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs text-[var(--text-secondary)]">
                      {user.createdAt.toLocaleDateString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
              Nenhum usuário ainda. Crie o primeiro acesso acima.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
