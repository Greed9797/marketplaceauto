/* eslint-disable @next/next/no-html-link-for-pages -- connector "Conectar"
   buttons are intentional full-page navigations to /api/* OAuth initiators
   (they 302 to Google/Nuvemshop), not client-side page links; next/link is
   wrong here. */
import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { Cable, CircleAlert, Settings } from "lucide-react";
import type { ReactNode } from "react";

import { ConnectorSyncError } from "@/components/connectors/connector-sync-error";
import { MetaSystemUserDialog } from "@/components/connectors/meta-system-user-dialog";
import { ShopifyConnectDialog } from "@/components/connectors/shopify-connect-dialog";
import { RemoveConnectorButton } from "@/components/connectors/remove-connector-button";
import { SyncNowButton } from "@/components/connectors/sync-now-button";
import { EventTracker } from "@/components/observability/event-tracker";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { resolveAppOrigin } from "@/lib/auth/origin";
import {
  canDeleteWorkspaceConnectors,
  canManageProviderConfigs,
  canOperateWorkspaceConnectors,
} from "@/lib/auth/platform-permissions";
import {
  isHiddenProvider,
  MARKETPLACE_FIRST,
} from "@/lib/connectors/marketplace-first";
import { getGlobalMercadoLivreConfig } from "@/lib/connectors/mercado-livre/global-config";
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import { getMlEnvConfig } from "@/lib/publisher/ml-env-config";
import { listPublicProviderConfigs } from "@/lib/connectors/provider-config";
import {
  getConnectorDefinition,
  manualCommerceProviders,
} from "@/lib/connectors/registry";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils/cn";

type ConnectorsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ProviderCard = {
  provider: ConnectorProvider;
  name: string;
  description: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "info";
  action: ReactNode;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusClass(tone: ProviderCard["statusTone"]) {
  return cn(
    "inline-flex rounded-[var(--radius-pill)] px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.04em]",
    tone === "success" && "bg-[var(--success-bg)] text-[var(--success)]",
    tone === "warning" && "bg-[var(--warning-bg)] text-[var(--warning)]",
    tone === "info" && "bg-[var(--info-bg)] text-[var(--info)]",
  );
}

function connectorMessage(
  error: string | undefined,
  connected: string | undefined,
  debug?: string | undefined,
) {
  if (connected === "meta") {
    return {
      tone: "success" as const,
      title: "Meta conectada.",
      body: "As contas de anuncio retornadas pela API foram salvas com token criptografado.",
    };
  }

  if (connected === "google-ads") {
    return {
      tone: "success" as const,
      title: "Google Ads conectado.",
      body: "As contas acessiveis foram salvas com token criptografado e prontas para backfill.",
    };
  }

  if (connected === "google-analytics") {
    return {
      tone: "success" as const,
      title: "Google Analytics conectado.",
      body: "As propriedades GA4 selecionadas foram salvas e prontas para sincronizar sessões.",
    };
  }

  if (connected === "shopify") {
    return {
      tone: "success" as const,
      title: "Shopify conectada.",
      body: "A loja foi salva com token criptografado e pronta para sincronizar pedidos.",
    };
  }

  if (connected === "nuvemshop") {
    return {
      tone: "success" as const,
      title: "Nuvemshop conectada.",
      body: "A loja selecionada foi salva com credenciais criptografadas e pronta para sincronizar pedidos.",
    };
  }

  if (connected === "mercado_livre") {
    return {
      tone: "success" as const,
      title: "Mercado Livre conectado.",
      body: "A conta do vendedor foi salva com credenciais criptografadas e pronta para sincronizar pedidos.",
    };
  }

  if (connected === "shopee") {
    return {
      tone: "success" as const,
      title: "Shopee conectada.",
      body: "A loja foi salva com credenciais criptografadas e pronta para sincronizar pedidos.",
    };
  }

  if (
    connected &&
    ["iset", "tray", "wbuy", "magazord", "google_sheets"].includes(connected)
  ) {
    return {
      tone: "success" as const,
      title:
        connected === "google_sheets"
          ? "Planilha conectada."
          : "Loja conectada.",
      body:
        connected === "google_sheets"
          ? "A planilha foi validada em tempo real e entrara na soma de pedidos aprovados do WhatsApp."
          : "Validamos as credenciais antes de salvar e a sincronizacao de pedidos ja pode rodar.",
    };
  }

  if (!error) {
    return null;
  }

  const messages: Record<string, string> = {
    "invalid-state":
      "O retorno da Meta nao passou na validacao de seguranca. Tente conectar de novo.",
    "missing-code":
      "A Meta nao retornou o codigo de autorizacao. Tente conectar novamente.",
    "missing-provider-config":
      "Esse conector ainda nao foi configurado no app pela equipe W3.",
    "meta-api":
      "Nao conseguimos concluir a conexao com a Meta agora. Tente novamente em alguns minutos.",
    "google-ads-api":
      "Nao conseguimos concluir a conexao com o Google Ads agora. Confira o developer token e tente novamente.",
    "oauth-failed":
      "OAuth retornou erro. Confira developer token, redirect URI e que a conta esta autorizada nos Test Users do Cloud Console.",
    "oauth-vault-missing":
      "Credenciais do provedor nao encontradas no Vault. Salve client ID/secret em /connectors/settings antes de tentar de novo.",
    "oauth-providerconfig-missing":
      "Provider config do Google Ads esta inativo ou nao foi salvo. Acesse /connectors/settings/google_ads e ative.",
    "google-analytics-api":
      "Nao conseguimos concluir a conexao com o Google Analytics agora. Confira o OAuth e tente novamente.",
    "invalid-hmac":
      "A assinatura retornada pela Shopify nao passou na validacao HMAC.",
    "invalid-shop": "Informe uma loja Shopify valida, como loja.myshopify.com.",
    "provider-denied": "A autorizacao foi cancelada no provedor.",
    "missing-shop": "Informe o dominio da loja Shopify antes de conectar.",
    "shopify-api":
      "Nao conseguimos concluir a conexao com a Shopify agora. Tente novamente em alguns minutos.",
    "nuvemshop-api":
      "Nao conseguimos concluir a conexao com a Nuvemshop agora. Tente novamente em alguns minutos.",
    "missing-selection": "Selecione pelo menos uma conta antes de vincular.",
    "selection-expired": "A selecao expirou. Inicie a conexao novamente.",
    "selection-failed":
      "Nao conseguimos salvar a selecao agora. Tente novamente.",
    "invalid-manual-connector": "Revise os dados da loja e tente novamente.",
    "manual-credentials":
      "Nao conseguimos validar essas credenciais. Confira a URL, caminho de pedidos e chaves da API.",
    forbidden:
      "Seu papel atual permite visualizar conectores, mas nao vincular ou alterar contas.",
  };

  const baseBody =
    messages[error] ?? "Nao conseguimos concluir a conexao agora.";
  const body = debug ? `${baseBody} (debug: ${debug})` : baseBody;

  return {
    tone: "warning" as const,
    title: "Conexao nao concluida.",
    body,
  };
}

export default async function ConnectorsPage({
  searchParams,
}: ConnectorsPageProps) {
  const context = await getCurrentUserContext();
  const params = await searchParams;
  const connectedProvider = firstParam(params.connected);
  const message = connectorMessage(
    firstParam(params.error),
    firstParam(params.connected),
    firstParam(params.debug),
  );
  const canConfigureProviders = canManageProviderConfigs(context.user);
  const canConnectAccounts = canOperateWorkspaceConnectors(
    context.user,
    context.currentMembership.role,
  );
  const canRemoveAccounts = canDeleteWorkspaceConnectors(
    context.user,
    context.currentMembership.role,
  );
  const connectorCounts = new Map<ConnectorProvider, number>();
  // Accounts whose token is broken (ERROR / TOKEN_EXPIRED). They still count as
  // "connected" but need re-auth — surfaced as a warning so managers reconnect.
  const erroredCounts = new Map<ConnectorProvider, number>();
  const providerConfigs = new Set<ConnectorProvider>();

  // Single connector read (was a redundant groupBy + findMany on the same
  // [workspaceId, provider] index) plus the provider configs in parallel.
  const [connectorAccounts, configs] = await Promise.all([
    prisma.connectorAccount.findMany({
      // Revoked connectors are soft-deleted: hidden from the connected list and
      // per-provider counts, but their historical orders/metrics are preserved.
      where: {
        workspaceId: context.currentWorkspace.id,
        status: { not: ConnectorStatus.REVOKED },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        accountName: true,
        externalAccountId: true,
        lastSyncedAt: true,
        lastSyncError: true,
        status: true,
        historicalSyncedAt: true,
        historicalBackfillUntil: true,
      },
    }),
    listPublicProviderConfigs(context.currentWorkspace.id),
  ]);

  // Per-provider counts derived in-process from the single read.
  for (const account of connectorAccounts) {
    connectorCounts.set(
      account.provider,
      (connectorCounts.get(account.provider) ?? 0) + 1,
    );
    if (
      account.status === ConnectorStatus.ERROR ||
      account.status === ConnectorStatus.TOKEN_EXPIRED
    ) {
      erroredCounts.set(
        account.provider,
        (erroredCounts.get(account.provider) ?? 0) + 1,
      );
    }
  }

  for (const config of configs) {
    if (config.status === "ACTIVE") {
      providerConfigs.add(config.provider);
    }
  }

  // Credenciais do "app oficial W3" via env também contam como configuradas:
  // o connect flow usa esse fallback quando o workspace não tem ProviderConfig,
  // então o card deve oferecer "Conectar" direto em vez de forçar o formulário.
  const appOrigin = await resolveAppOrigin();
  const hasMlConnectorConfig =
    providerConfigs.has(ConnectorProvider.MERCADO_LIVRE) ||
    Boolean(getGlobalMercadoLivreConfig(appOrigin));
  if (hasMlConnectorConfig) {
    providerConfigs.add(ConnectorProvider.MERCADO_LIVRE);
  }
  if (getGlobalShopeeConfig(appOrigin)) {
    providerConfigs.add(ConnectorProvider.SHOPEE);
  }
  // App ML do publisher (ML_APP_ID/ML_SECRET, redirect /api/auth/ml/callback já
  // registrado no painel do ML) também conecta o workspace — o callback cria a
  // mesma ConnectorAccount. Sem config do conector, o card usa esse fluxo.
  const useMlPublisherFlow = !hasMlConnectorConfig && Boolean(getMlEnvConfig());
  if (useMlPublisherFlow) {
    providerConfigs.add(ConnectorProvider.MERCADO_LIVRE);
  }
  const mlConnectHref = useMlPublisherFlow
    ? "/api/auth/ml"
    : "/api/connectors/mercado-livre/connect";

  const metaAccounts = connectorCounts.get(ConnectorProvider.META_ADS) ?? 0;
  const googleAdsAccounts =
    connectorCounts.get(ConnectorProvider.GOOGLE_ADS) ?? 0;
  const googleAnalyticsProperties =
    connectorCounts.get(ConnectorProvider.GA4) ?? 0;
  const shopifyAccounts = connectorCounts.get(ConnectorProvider.SHOPIFY) ?? 0;
  const nuvemshopAccounts =
    connectorCounts.get(ConnectorProvider.NUVEMSHOP) ?? 0;
  const mercadoLivreAccounts =
    connectorCounts.get(ConnectorProvider.MERCADO_LIVRE) ?? 0;
  const shopeeAccounts = connectorCounts.get(ConnectorProvider.SHOPEE) ?? 0;

  function missingConfigAction(provider: ConnectorProvider) {
    if (canConfigureProviders) {
      return (
        <Button asChild size="sm" variant="secondary">
          <a href={`/connectors/settings/${provider.toLowerCase()}`}>
            <Settings size={16} aria-hidden="true" />
            Configurar no app
          </a>
        </Button>
      );
    }

    return (
      <Button disabled size="sm" variant="secondary">
        <Settings size={16} aria-hidden="true" />
        Aguardando W3
      </Button>
    );
  }

  function readOnlyAction() {
    return (
      <Button disabled size="sm" variant="secondary">
        <Cable size={16} aria-hidden="true" />
        Somente leitura
      </Button>
    );
  }

  function connectorAction(provider: ConnectorProvider, action: ReactNode) {
    if (!providerConfigs.has(provider)) return missingConfigAction(provider);
    if (!canConnectAccounts) return readOnlyAction();

    return action;
  }

  function statusLabel(
    provider: ConnectorProvider,
    count: number,
    unit: string,
  ) {
    const errored = erroredCounts.get(provider) ?? 0;
    const active = count - errored;
    if (active > 0) {
      return errored > 0
        ? `${active} ${unit}(s) ativa(s) · ${errored} com erro — reconectar`
        : `${active} ${unit}(s) ativa(s)`;
    }
    if (errored > 0) {
      return `Reconexão necessária (${errored} com erro)`;
    }
    if (providerConfigs.has(provider)) return "Pronto para conectar";

    return "Aguardando configuração W3";
  }

  function statusTone(provider: ConnectorProvider, count: number) {
    const errored = erroredCounts.get(provider) ?? 0;
    const active = count - errored;
    // A broken token is the most important signal — show it even if there are
    // other healthy accounts on the same provider.
    if (errored > 0) return "warning" as const;
    if (active > 0) return "success" as const;
    if (providerConfigs.has(provider)) return "info" as const;

    return "warning" as const;
  }

  const providerCards: ProviderCard[] = [
    {
      provider: ConnectorProvider.META_ADS,
      name: "Meta Ads",
      description:
        "Conecte o perfil e vincule somente as contas de anuncio dos clientes selecionados.",
      statusLabel: statusLabel(
        ConnectorProvider.META_ADS,
        metaAccounts,
        "conta",
      ),
      statusTone: statusTone(ConnectorProvider.META_ADS, metaAccounts),
      action: connectorAction(
        ConnectorProvider.META_ADS,
        <MetaSystemUserDialog />,
      ),
    },
    {
      provider: ConnectorProvider.GOOGLE_ADS,
      name: "Google Ads",
      description:
        "Conecte o usuario/MCC, expanda a hierarquia e vincule apenas contas anunciante.",
      statusLabel: statusLabel(
        ConnectorProvider.GOOGLE_ADS,
        googleAdsAccounts,
        "conta",
      ),
      statusTone: statusTone(ConnectorProvider.GOOGLE_ADS, googleAdsAccounts),
      action: connectorAction(
        ConnectorProvider.GOOGLE_ADS,
        <Button asChild size="sm">
          <a
            href={`/api/connectors/google-ads/connect?ws=${context.currentWorkspace.id}`}
          >
            <Cable size={16} aria-hidden="true" />
            Conectar Google
          </a>
        </Button>,
      ),
    },
    {
      provider: ConnectorProvider.GA4,
      name: "Google Analytics",
      description:
        "Conecte o Google Analytics e vincule as propriedades GA4 dos clientes para puxar sessões.",
      statusLabel: statusLabel(
        ConnectorProvider.GA4,
        googleAnalyticsProperties,
        "propriedade",
      ),
      statusTone: statusTone(ConnectorProvider.GA4, googleAnalyticsProperties),
      action: connectorAction(
        ConnectorProvider.GA4,
        <Button asChild size="sm">
          <a
            href={`/api/connectors/google-analytics/connect?ws=${context.currentWorkspace.id}`}
          >
            <Cable size={16} aria-hidden="true" />
            Conectar Analytics
          </a>
        </Button>,
      ),
    },
    {
      provider: ConnectorProvider.SHOPIFY,
      name: "Shopify",
      description:
        "Conecte a loja, ingira pedidos via GraphQL e receba webhooks assinados.",
      statusLabel: statusLabel(
        ConnectorProvider.SHOPIFY,
        shopifyAccounts,
        "loja",
      ),
      statusTone: statusTone(ConnectorProvider.SHOPIFY, shopifyAccounts),
      action: connectorAction(
        ConnectorProvider.SHOPIFY,
        <ShopifyConnectDialog />,
      ),
    },
    {
      provider: ConnectorProvider.NUVEMSHOP,
      name: "Nuvemshop",
      description:
        "Conecte via OAuth, selecione a loja e sincronize pedidos e receita.",
      statusLabel: statusLabel(
        ConnectorProvider.NUVEMSHOP,
        nuvemshopAccounts,
        "loja",
      ),
      statusTone: statusTone(ConnectorProvider.NUVEMSHOP, nuvemshopAccounts),
      action: connectorAction(
        ConnectorProvider.NUVEMSHOP,
        <Button asChild size="sm">
          <a href="/api/connectors/nuvemshop/connect">
            <Cable size={16} aria-hidden="true" />
            Conectar Nuvemshop
          </a>
        </Button>,
      ),
    },
    {
      provider: ConnectorProvider.MERCADO_LIVRE,
      name: "Mercado Livre",
      description:
        "Conecte via OAuth a conta do vendedor e sincronize pedidos e receita.",
      statusLabel: statusLabel(
        ConnectorProvider.MERCADO_LIVRE,
        mercadoLivreAccounts,
        "conta",
      ),
      statusTone: statusTone(
        ConnectorProvider.MERCADO_LIVRE,
        mercadoLivreAccounts,
      ),
      action: connectorAction(
        ConnectorProvider.MERCADO_LIVRE,
        <Button asChild size="sm">
          <a href={mlConnectHref}>
            <Cable size={16} aria-hidden="true" />
            Conectar Mercado Livre
          </a>
        </Button>,
      ),
    },
    {
      provider: ConnectorProvider.SHOPEE,
      name: "Shopee",
      description:
        "Conecte via OAuth a loja Shopee e sincronize pedidos e receita.",
      statusLabel: statusLabel(
        ConnectorProvider.SHOPEE,
        shopeeAccounts,
        "loja",
      ),
      statusTone: statusTone(ConnectorProvider.SHOPEE, shopeeAccounts),
      action: connectorAction(
        ConnectorProvider.SHOPEE,
        <Button asChild size="sm">
          <a href="/api/connectors/shopee/connect">
            <Cable size={16} aria-hidden="true" />
            Conectar Shopee
          </a>
        </Button>,
      ),
    },
    ...manualCommerceProviders.map((provider) => {
      const definition = getConnectorDefinition(provider);
      const count = connectorCounts.get(provider) ?? 0;

      return {
        provider,
        name: definition.name,
        description:
          "Use a configuração W3 do workspace para validar e vincular a loja.",
        statusLabel: statusLabel(provider, count, "loja"),
        statusTone: statusTone(provider, count),
        action: connectorAction(
          provider,
          <form
            action="/api/connectors/manual"
            className="grid gap-2"
            method="post"
          >
            <input name="provider" type="hidden" value={provider} />
            <label
              className="text-caption text-[var(--text-tertiary)]"
              htmlFor={`${provider}-name`}
            >
              Loja
            </label>
            <input
              className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm"
              id={`${provider}-name`}
              name="storeName"
              placeholder="Nome da loja"
              required
            />
            <Button className="w-fit" size="sm" type="submit">
              <Cable size={16} aria-hidden="true" />
              Validar e vincular
            </Button>
          </form>,
        ),
      };
    }),
    // Marketplace-first mode hides the paid-traffic connectors (Meta/Google
    // Ads, GA4, Search Console) without touching the enum or registry.
  ].filter((card) => !isHiddenProvider(card.provider));

  return (
    <div className="space-y-6">
      {connectedProvider ? (
        <EventTracker
          name="connector_connect"
          properties={{ provider: connectedProvider }}
          userId={context.user.id}
          workspaceId={context.currentWorkspace.id}
        />
      ) : null}
      <div>
        <p className="text-caption text-[var(--text-tertiary)]">Conectores</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          {MARKETPLACE_FIRST ? "Marketplaces e lojas" : "Fontes de dados"}
        </h2>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-3 text-sm">
        <CircleAlert
          className="mt-0.5 shrink-0 text-[var(--text-tertiary)]"
          size={16}
          aria-hidden="true"
        />
        <p className="leading-6">
          Conectando para{" "}
          <span className="font-semibold text-[var(--text-primary)]">
            {context.currentWorkspace.name}
          </span>
          . Tudo que você vincular aqui entra nesse workspace — troque o
          workspace no topo antes de conectar para outro cliente.
        </p>
      </div>

      {message ? (
        <div
          className={cn(
            "flex gap-3 rounded-md border px-4 py-3 text-sm",
            message.tone === "success" &&
              "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]",
            message.tone === "warning" &&
              "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]",
          )}
        >
          <CircleAlert
            className="mt-0.5 shrink-0"
            size={16}
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">{message.title}</p>
            <p className="mt-1">{message.body}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {providerCards.map((provider) => (
          <Card key={provider.provider}>
            <CardHeader className="items-center">
              <CardTitle>{provider.name}</CardTitle>
              <ProviderLogo provider={provider.provider} />
            </CardHeader>
            <CardContent className="flex min-h-[180px] flex-col justify-between gap-5">
              <div>
                <p className="text-sm leading-6 text-[var(--text-secondary)]">
                  {provider.description}
                </p>
                <span className={cn("mt-4", statusClass(provider.statusTone))}>
                  {provider.statusLabel}
                </span>
              </div>
              <div className="space-y-2">
                {provider.provider === ConnectorProvider.META_ADS ||
                provider.provider === ConnectorProvider.GOOGLE_ADS ||
                provider.provider === ConnectorProvider.GA4 ? (
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Conectando para{" "}
                    <span className="font-medium text-[var(--text-secondary)]">
                      {context.currentWorkspace.name}
                    </span>
                  </p>
                ) : null}
                {provider.action}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {connectorAccounts.length > 0 && canConnectAccounts ? (
        <section>
          <h3 className="text-lg font-semibold tracking-[-0.02em]">
            Contas conectadas
          </h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Force uma sincronização manual quando precisar atualizar o dashboard
            imediatamente.
          </p>
          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border-subtle)]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
                <tr>
                  <th className="px-4 py-3">Conector</th>
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Última sync</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {connectorAccounts.map((account) => {
                  const definition = getConnectorDefinition(account.provider);

                  return (
                    <tr
                      className="border-t border-[var(--border-subtle)]"
                      key={account.id}
                    >
                      <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <ProviderLogo
                            className="size-6"
                            provider={account.provider}
                          />
                          {definition.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {account.accountName ?? account.externalAccountId}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {account.lastSyncedAt
                          ? new Date(account.lastSyncedAt).toLocaleString(
                              "pt-BR",
                              { timeZone: "America/Sao_Paulo" },
                            )
                          : "—"}
                        {account.lastSyncError ? (
                          <ConnectorSyncError
                            error={account.lastSyncError}
                            provider={account.provider}
                          />
                        ) : null}
                        {!account.historicalSyncedAt &&
                        account.historicalBackfillUntil ? (
                          <p className="mt-1 text-[var(--text-tertiary)]">
                            Sincronizando histórico em segundo plano: até{" "}
                            {new Date(account.historicalBackfillUntil)
                              .toISOString()
                              .slice(0, 7)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <SyncNowButton connectorAccountId={account.id} />
                          {canRemoveAccounts ? (
                            <RemoveConnectorButton
                              accountLabel={
                                account.accountName ?? account.externalAccountId
                              }
                              connectorAccountId={account.id}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
