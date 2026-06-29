import { Download, ShieldCheck, Trash2, UserCircle } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { getWorkspaceRoleDefinition } from "@/lib/auth/permissions";

export default async function ProfilePage() {
  const context = await getCurrentUserContext();

  return (
    <div className="space-y-6">
      <section>
        <p className="text-caption text-[var(--text-tertiary)]">Perfil</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Conta e privacidade
        </h2>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Dados da conta</CardTitle>
          <UserCircle aria-hidden className="size-5 text-[var(--w3-red)]" />
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
          <div>
            <p className="text-caption text-[var(--text-tertiary)]">Nome</p>
            <p className="mt-1 font-medium text-[var(--text-primary)]">
              {context.user.name ?? "-"}
            </p>
          </div>
          <div>
            <p className="text-caption text-[var(--text-tertiary)]">Email</p>
            <p className="mt-1 font-medium text-[var(--text-primary)]">
              {context.user.email}
            </p>
          </div>
          <div>
            <p className="text-caption text-[var(--text-tertiary)]">
              Workspace atual
            </p>
            <p className="mt-1 font-medium text-[var(--text-primary)]">
              {context.currentWorkspace.name}
            </p>
          </div>
          <div>
            <p className="text-caption text-[var(--text-tertiary)]">Papel</p>
            <p className="mt-1 font-medium text-[var(--text-primary)]">
              {getWorkspaceRoleDefinition(context.currentMembership.role).label}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exportação de dados</CardTitle>
            <Download aria-hidden className="size-5 text-[var(--info)]" />
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[var(--text-secondary)]">
            <p>
              Baixe um JSON com os dados da sua conta e vínculo com workspaces.
            </p>
            <Button asChild variant="secondary">
              <Link href="/profile/data-export">Abrir exportação</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exclusão de conta</CardTitle>
            <Trash2 aria-hidden className="size-5 text-[var(--danger)]" />
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[var(--text-secondary)]">
            <p>
              Solicite a exclusão com confirmação por email. Em produção, a
              conta fica marcada para purge.
            </p>
            <Button asChild variant="secondary">
              <Link href="/profile/delete-account">Solicitar exclusão</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Privacidade</CardTitle>
          <ShieldCheck aria-hidden className="size-5 text-[var(--success)]" />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="ghost">
            <Link href="/terms">Termos de uso</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/privacy">Política de privacidade</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
