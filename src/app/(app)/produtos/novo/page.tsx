import { Package } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";

import { NovoProdutoForm } from "./novo-produto-form";

export const dynamic = "force-dynamic";

export default async function NovoProdutoPage() {
  const context = await getCurrentUserContext();
  const clientes = await prisma.cliente.findMany({
    where: { workspaceId: context.currentWorkspace.id },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Publicador</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Novo produto
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Cadastre um rascunho para depois enriquecer e publicar.
        </p>
      </div>

      {clientes.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Package
                aria-hidden
                className="size-7 text-[var(--text-tertiary)]"
              />
              <p className="text-sm text-[var(--text-secondary)]">
                Você precisa cadastrar um cliente antes de criar produtos.
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link href="/clientes">Ir para Clientes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <NovoProdutoForm clientes={clientes} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
