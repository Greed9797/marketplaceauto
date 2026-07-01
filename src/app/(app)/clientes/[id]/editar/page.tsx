import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import { prisma } from "@/lib/db/prisma";

import { ClienteEditForm, type ClienteEditData } from "./cliente-edit-form";

export const dynamic = "force-dynamic";

type ClienteEditarPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClienteEditarPage({
  params,
}: ClienteEditarPageProps) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    redirect("/clientes");
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id, workspaceId: context.currentWorkspace.id },
  });

  if (!cliente) notFound();

  const data: ClienteEditData = {
    id: cliente.id,
    nome: cliente.nome,
    nicho: cliente.nicho ?? "",
    estiloDescricao: cliente.estiloDescricao ?? "",
    exemplosTitulos: cliente.exemplosTitulos ?? "",
    exemplosDescricoes: cliente.exemplosDescricoes ?? "",
    dadosFiscais: cliente.dadosFiscais ?? "",
    comissaoPercent:
      cliente.comissaoPercent != null ? String(cliente.comissaoPercent) : "",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Publicador</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Editar cliente
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Enriqueça o perfil para melhorar a geração de copy com IA.
          </p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/clientes">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardContent>
          <ClienteEditForm cliente={data} />
        </CardContent>
      </Card>
    </div>
  );
}
