import { ConnectorProvider } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canManageProviderConfigs } from "@/lib/auth/platform-permissions";
import { getConnectorDefinition } from "@/lib/connectors/registry";
import { listPublicProviderConfigs } from "@/lib/connectors/provider-config";
import { prisma } from "@/lib/db/prisma";

const configurableProviders = [
  ConnectorProvider.META_ADS,
  ConnectorProvider.GOOGLE_ADS,
  ConnectorProvider.SHOPIFY,
  ConnectorProvider.NUVEMSHOP,
  ConnectorProvider.ISET,
  ConnectorProvider.TRAY,
  ConnectorProvider.WBUY,
  ConnectorProvider.MAGAZORD,
  ConnectorProvider.GOOGLE_SHEETS,
  ConnectorProvider.LOJA_INTEGRADA,
  ConnectorProvider.GA4,
] as const;

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConnectorSettingsPage({
  searchParams,
}: SettingsPageProps) {
  const context = await getCurrentUserContext();
  if (!canManageProviderConfigs(context.user)) {
    const existingAdmins = await prisma.user.count({
      where: { platformRole: { in: ["ADMIN_MASTER", "W3_ADMIN"] } },
    });
    if (existingAdmins === 0) {
      redirect("/platform/bootstrap");
    }

    redirect("/connectors");
  }

  const params = await searchParams;
  const saved = firstParam(params.saved);
  const deleted = firstParam(params.deleted);
  const configs = await listPublicProviderConfigs(context.currentWorkspace.id);
  const configByProvider = new Map(
    configs.map((config) => [config.provider, config]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">
            Configuração W3
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Apps e APIs dos conectores
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
            Credenciais de aplicativo ficam no Vault. Workspaces conectam contas
            usando estas configurações sem depender de .env local.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/connectors">Voltar aos conectores</Link>
        </Button>
      </div>

      {saved || deleted ? (
        <div className="rounded-md border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Configuração atualizada.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {configurableProviders.map((provider) => {
          const definition = getConnectorDefinition(provider);
          const config = configByProvider.get(provider);

          return (
            <Card key={provider}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{definition.name}</CardTitle>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {config?.status === "ACTIVE"
                      ? "Ativo no workspace"
                      : "Aguardando configuração"}
                  </p>
                </div>
                <ProviderLogo provider={provider} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-xs text-[var(--text-tertiary)]">
                  Segredos configurados:{" "}
                  {config?.configuredSecretKeys.length ?? 0}
                </div>
                <Button
                  asChild
                  size="sm"
                  variant={config ? "secondary" : "primary"}
                >
                  <Link href={`/connectors/settings/${provider.toLowerCase()}`}>
                    {config ? "Editar" : "Configurar"}
                    <ChevronRight size={15} aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
