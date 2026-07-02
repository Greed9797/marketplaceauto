import { ConnectorProvider } from "@prisma/client";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConnectorSyncError } from "@/components/connectors/connector-sync-error";
import { MetaProviderSettings } from "@/components/connectors/meta-provider-settings";
import { SyncNowButton } from "@/components/connectors/sync-now-button";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canManageProviderConfigs } from "@/lib/auth/platform-permissions";
import {
  publicProviderDefaults,
  type PublicProviderDefaults,
} from "@/lib/connectors/global-defaults";
import {
  getProviderConfig,
  publicProviderConfig,
  type PublicProviderConfig,
} from "@/lib/connectors/provider-config";
import {
  getConnectorDefinition,
  isManualCommerceProvider,
} from "@/lib/connectors/registry";
import { prisma } from "@/lib/db/prisma";

import {
  deleteProviderConfigAction,
  saveProviderConfigAction,
  validateProviderConfigAction,
} from "../actions";

type ProviderConfigPageProps = {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function providerFromParam(value: string) {
  return Object.values(ConnectorProvider).find(
    (provider) => provider.toLowerCase() === value,
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function inputClass() {
  return "h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";
}

function Field({
  name,
  label,
  type = "text",
  defaultValue,
  placeholder,
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-caption text-[var(--text-tertiary)]">{label}</span>
      <input
        className={inputClass()}
        defaultValue={defaultValue ?? ""}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function publicCredential(config: PublicProviderConfig | null, key: string) {
  return config?.publicCredentials[key] ?? "";
}

function hasSecret(config: PublicProviderConfig | null, key: string) {
  return config?.configuredSecretKeys.includes(key) ?? false;
}

/**
 * Merges the official env-backed defaults UNDER the saved DB config (DB wins)
 * so form fields pre-fill with the official W3 Ads credentials. Used only for
 * field display — page-level status/delete still read the real `config`.
 */
function mergeConfigWithDefaults(
  provider: ConnectorProvider,
  providerName: string,
  config: PublicProviderConfig | null,
  defaults: PublicProviderDefaults | null,
): PublicProviderConfig | null {
  if (!defaults) {
    return config;
  }

  return {
    id: config?.id ?? "",
    workspaceId: config?.workspaceId ?? "",
    provider,
    providerName: config?.providerName ?? providerName,
    status: config?.status ?? "ACTIVE",
    redirectUri: config?.redirectUri ?? defaults.redirectUri,
    scopes: config?.scopes ?? defaults.scopes,
    apiVersion: config?.apiVersion ?? defaults.apiVersion,
    baseUrl: config?.baseUrl ?? null,
    ordersPath: config?.ordersPath ?? null,
    displayName: config?.displayName ?? null,
    publicCredentials: {
      ...defaults.publicCredentials,
      ...(config?.publicCredentials ?? {}),
    },
    configuredSecretKeys: Array.from(
      new Set([
        ...defaults.configuredSecretKeys,
        ...(config?.configuredSecretKeys ?? []),
      ]),
    ).sort(),
    lastValidatedAt: config?.lastValidatedAt ?? null,
    lastValidationError: config?.lastValidationError ?? null,
  };
}

function SecretField({
  name,
  label,
  configured,
  placeholder,
}: {
  name: string;
  label: string;
  configured: boolean;
  /** Empty-state hint. Defaults to "Obrigatório" for genuinely required secrets;
   * pass a softer hint for fields that are only conditionally required. */
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-caption text-[var(--text-tertiary)]">{label}</span>
      <input
        className={inputClass()}
        name={name}
        placeholder={
          configured
            ? "Já configurado. Preencha só para trocar."
            : (placeholder ?? "Obrigatório")
        }
        type="password"
      />
    </label>
  );
}

function ProviderSpecificFields({
  provider,
  config,
}: {
  provider: ConnectorProvider;
  config: PublicProviderConfig | null;
}) {
  if (provider === ConnectorProvider.META_ADS) {
    return (
      <>
        <div className="col-span-full rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            MVP: conecte via System User Token em{" "}
            <a className="underline" href="/connectors">
              /connectors
            </a>
            .
          </strong>{" "}
          Os campos abaixo de OAuth são opcionais e só precisam ser preenchidos
          se você optar pelo fluxo OAuth tradicional.
        </div>
        <Field
          name="appId"
          label="Meta App ID (opcional, só OAuth)"
          defaultValue={publicCredential(config, "appId")}
        />
        <SecretField
          name="appSecret"
          label="Meta App Secret (opcional, só OAuth)"
          configured={hasSecret(config, "appSecret")}
        />
        <Field
          name="apiVersion"
          label="API version"
          defaultValue={config?.apiVersion ?? "v25.0"}
        />
        <Field
          name="redirectUri"
          label="Redirect URI (opcional, só OAuth)"
          defaultValue={config?.redirectUri}
        />
        <Field
          name="scopes"
          label="Scopes (opcional, só OAuth)"
          defaultValue={
            config?.scopes ??
            "ads_read,ads_management,business_management,read_insights"
          }
        />
        <Field
          name="leadEventId"
          label="Pixel event ID — Lead"
          defaultValue={publicCredential(config, "leadEventId")}
          placeholder="Opcional. Ex: 823314883920077"
        />
        <Field
          name="scheduledEventId"
          label="Pixel event ID — Agendamento"
          defaultValue={publicCredential(config, "scheduledEventId")}
          placeholder="Opcional. Ex: 823314883920077"
        />
      </>
    );
  }

  if (provider === ConnectorProvider.GOOGLE_ADS) {
    return (
      <>
        <div className="col-span-full rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            Setup expresso (MVP):
          </strong>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>
              Google Ads MCC →{" "}
              <em>Ferramentas e configurações → Centro de API</em> → copie o{" "}
              <code className="rounded bg-[var(--bg-surface)] px-1">
                Developer Token
              </code>{" "}
              (Test access libera na hora; produção pode levar dias).
            </li>
            <li>
              Google Cloud Console → novo projeto → ative{" "}
              <em>Google Ads API</em> → OAuth Consent (External, e-mail/nome) →{" "}
              <em>Credenciais</em> → criar OAuth Client ID tipo{" "}
              <em>Aplicativo da Web</em>.
            </li>
            <li>
              No campo <em>Authorized redirect URIs</em> do Google Cloud, cole o
              Redirect URI exibido abaixo (ou deixe em branco que o app calcula
              automaticamente).
            </li>
          </ol>
        </div>
        <Field
          name="clientId"
          label="Google OAuth Client ID"
          defaultValue={publicCredential(config, "clientId")}
          required
        />
        <SecretField
          name="clientSecret"
          label="Google OAuth Client Secret"
          configured={hasSecret(config, "clientSecret")}
        />
        <SecretField
          name="developerToken"
          label="Google Ads Developer Token"
          configured={hasSecret(config, "developerToken")}
        />
        <Field
          name="apiVersion"
          label="API version"
          defaultValue={config?.apiVersion ?? "v24"}
        />
        <Field
          name="redirectUri"
          label="Redirect URI (auto se vazio)"
          defaultValue={config?.redirectUri}
          placeholder="https://<seu-host>/api/connectors/google-ads/callback"
        />
        <Field
          name="loginCustomerId"
          label="Login Customer ID (MCC de teste, só dígitos)"
          defaultValue={publicCredential(config, "loginCustomerId")}
          placeholder="Ex: 1234567890"
        />
      </>
    );
  }

  if (provider === ConnectorProvider.GA4) {
    return (
      <>
        <Field
          name="clientId"
          label="Google OAuth Client ID"
          defaultValue={publicCredential(config, "clientId")}
          required
        />
        <SecretField
          name="clientSecret"
          label="Google OAuth Client Secret"
          configured={hasSecret(config, "clientSecret")}
        />
        <Field
          name="redirectUri"
          label="Redirect URI"
          defaultValue={config?.redirectUri}
          required
        />
        <Field
          name="scopes"
          label="Scopes"
          defaultValue={
            config?.scopes ??
            "https://www.googleapis.com/auth/analytics.readonly"
          }
        />
      </>
    );
  }

  if (provider === ConnectorProvider.SHOPIFY) {
    return (
      <>
        <Field
          name="apiKey"
          label="Client ID"
          placeholder="Insira o Client ID do app Shopify"
          defaultValue={publicCredential(config, "apiKey")}
          required
        />
        <SecretField
          name="apiSecret"
          label="Client Secret"
          configured={hasSecret(config, "apiSecret")}
        />
        <Field
          name="shopDomain"
          label="Domínio da Loja"
          placeholder="minha-loja.myshopify.com"
          defaultValue={publicCredential(config, "shopDomain")}
        />
        <Field
          name="apiVersion"
          label="API version"
          defaultValue={config?.apiVersion ?? "2026-04"}
        />
        <Field
          name="scopes"
          label="Scopes"
          defaultValue={
            config?.scopes ??
            "read_orders,read_products,read_customers,read_analytics"
          }
        />
      </>
    );
  }

  if (provider === ConnectorProvider.NUVEMSHOP) {
    return (
      <>
        <Field
          name="clientId"
          label="Nuvemshop Client ID"
          defaultValue={publicCredential(config, "clientId")}
          required
        />
        <SecretField
          name="clientSecret"
          label="Nuvemshop Client Secret"
          configured={hasSecret(config, "clientSecret")}
        />
        <Field
          name="redirectUri"
          label="Redirect URI"
          defaultValue={config?.redirectUri}
          required
        />
        <Field
          name="baseUrl"
          label="Base URL API"
          defaultValue={config?.baseUrl ?? "https://api.nuvemshop.com.br/v1"}
        />
      </>
    );
  }

  if (provider === ConnectorProvider.MERCADO_LIVRE) {
    return (
      <>
        <Field
          name="clientId"
          label="Mercado Livre App ID (Client ID)"
          defaultValue={publicCredential(config, "clientId")}
          required
        />
        <SecretField
          name="clientSecret"
          label="Mercado Livre Client Secret"
          configured={hasSecret(config, "clientSecret")}
        />
        <Field
          name="redirectUri"
          label="Redirect URI"
          defaultValue={config?.redirectUri}
          placeholder="preenchido automaticamente ao salvar"
        />
        <Field
          name="baseUrl"
          label="Base URL API"
          defaultValue={config?.baseUrl ?? "https://api.mercadolibre.com"}
        />
      </>
    );
  }

  if (provider === ConnectorProvider.SHOPEE) {
    return (
      <>
        <Field
          name="partnerId"
          label="Shopee Partner ID"
          defaultValue={publicCredential(config, "partnerId")}
          required
        />
        <SecretField
          name="partnerKey"
          label="Shopee Partner Key (assinatura HMAC)"
          configured={hasSecret(config, "partnerKey")}
        />
        <Field
          name="redirectUri"
          label="Redirect URI"
          defaultValue={config?.redirectUri}
          placeholder="preenchido automaticamente ao salvar"
        />
        <Field
          name="baseUrl"
          label="Host da API"
          defaultValue={config?.baseUrl ?? "https://partner.shopeemobile.com"}
        />
      </>
    );
  }

  if (isManualCommerceProvider(provider)) {
    if (provider === ConnectorProvider.ISET) {
      return (
        <>
          <Field
            name="baseUrl"
            label="Domínio da loja"
            defaultValue={config?.baseUrl}
            placeholder="www.minhaloja.com.br"
            required
          />
          <SecretField
            name="apiUser"
            label="Identificador da API (ID de usuário)"
            configured={hasSecret(config, "apiUser")}
          />
          <SecretField
            name="apiKey"
            label="Chave de acesso da API"
            configured={
              hasSecret(config, "apiKey") ||
              Boolean(publicCredential(config, "apiKey"))
            }
          />
        </>
      );
    }

    if (provider === ConnectorProvider.GOOGLE_SHEETS) {
      return (
        <>
          <Field
            name="baseUrl"
            label="URL da planilha Google"
            defaultValue={config?.baseUrl}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
            required
          />
          <Field
            name="ordersPath"
            label="GID da aba"
            defaultValue={config?.ordersPath}
            placeholder="Opcional se a URL ja tiver gid"
          />
        </>
      );
    }

    if (provider === ConnectorProvider.LOJA_INTEGRADA) {
      return (
        <>
          <SecretField
            name="apiKey"
            label="Chave de API (chave_api da loja)"
            configured={
              hasSecret(config, "apiKey") ||
              Boolean(publicCredential(config, "apiKey"))
            }
          />
          <SecretField
            name="apiSecret"
            label="Chave de Aplicação (chave_aplicacao)"
            configured={hasSecret(config, "apiSecret")}
          />
          <Field
            name="baseUrl"
            label="URL base da API"
            defaultValue={config?.baseUrl}
            placeholder="Opcional — padrão: api.awsli.com.br/v1"
          />
        </>
      );
    }

    return (
      <>
        <Field
          name="baseUrl"
          label="URL base da API"
          defaultValue={config?.baseUrl}
          placeholder={
            provider === ConnectorProvider.WBUY
              ? "Opcional — padrão: sistema.sistemawbuy.com.br/api/v1"
              : undefined
          }
          required={provider !== ConnectorProvider.WBUY}
        />
        <Field
          name="ordersPath"
          label="Caminho de pedidos"
          defaultValue={
            config?.ordersPath ??
            (provider === ConnectorProvider.WBUY ? "/order" : "/orders")
          }
        />
        <SecretField
          name="apiUser"
          label="Usuário API"
          configured={hasSecret(config, "apiUser")}
          placeholder="Informe ao menos uma credencial"
        />
        <SecretField
          name="apiPassword"
          label="Senha API"
          configured={hasSecret(config, "apiPassword")}
          placeholder="Informe ao menos uma credencial"
        />
        <SecretField
          name="apiKey"
          label="API key / token"
          configured={
            hasSecret(config, "apiKey") ||
            Boolean(publicCredential(config, "apiKey"))
          }
          placeholder="Opcional"
        />
        <SecretField
          name="apiSecret"
          label="API secret"
          configured={hasSecret(config, "apiSecret")}
          placeholder="Opcional"
        />
      </>
    );
  }

  return null;
}

export default async function ConnectorProviderSettingsPage({
  params,
  searchParams,
}: ProviderConfigPageProps) {
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

  const { provider: providerParam } = await params;
  const provider = providerFromParam(providerParam);
  if (!provider) {
    notFound();
  }

  const rawConfig = await getProviderConfig({
    workspaceId: context.currentWorkspace.id,
    provider,
  });
  const config = rawConfig ? publicProviderConfig(rawConfig) : null;
  const definition = getConnectorDefinition(provider);
  const defaults = publicProviderDefaults(provider);
  const fieldConfig = mergeConfigWithDefaults(
    provider,
    definition.name,
    config,
    defaults,
  );
  const query = await searchParams;
  const error = firstParam(query.error);
  const saved = firstParam(query.saved);
  const validated = firstParam(query.validated);

  const googleSheetsAccount =
    provider === ConnectorProvider.GOOGLE_SHEETS
      ? await prisma.connectorAccount.findFirst({
          where: {
            workspaceId: context.currentWorkspace.id,
            provider: ConnectorProvider.GOOGLE_SHEETS,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            accountName: true,
            lastSyncedAt: true,
            lastSyncError: true,
            externalAccountId: true,
          },
        })
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">
            Configuração do conector
          </p>
          <div className="mt-2 flex items-center gap-3">
            <ProviderLogo provider={provider} />
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">
              {definition.name}
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
            Os campos sensíveis são gravados no Vault e nunca são renderizados
            de volta no app.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/connectors/settings">Todos os provedores</Link>
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)]">
          {error}
        </div>
      ) : null}
      {saved || validated ? (
        <div className="rounded-md border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          Configuração validada.
        </div>
      ) : null}

      {defaults ? (
        <div className="rounded-md border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
          <strong>Credenciais oficiais W3 Ads pré-configuradas.</strong> Deixe
          os campos em branco para usar os valores oficiais — preencha apenas o
          que quiser sobrescrever. Account ID e nome continuam manuais.
        </div>
      ) : null}

      {provider === ConnectorProvider.META_ADS ? (
        <MetaProviderSettings
          config={config}
          accessTokenPreset={
            defaults?.configuredSecretKeys.includes("accessToken") ?? false
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Dados do app/API</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" action={saveProviderConfigAction}>
              <input type="hidden" name="provider" value={provider} />
              <Field
                name="displayName"
                label="Nome interno"
                defaultValue={config?.displayName ?? definition.name}
              />
              <label className="grid gap-2">
                <span className="text-caption text-[var(--text-tertiary)]">
                  Status
                </span>
                <select
                  className={inputClass()}
                  name="status"
                  defaultValue={config?.status ?? "ACTIVE"}
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="INACTIVE">Inativo</option>
                </select>
              </label>
              <div className="grid gap-4 lg:grid-cols-2">
                <ProviderSpecificFields
                  provider={provider}
                  config={fieldConfig}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit">Salvar configuração</Button>
                <Button
                  formAction={validateProviderConfigAction}
                  type="submit"
                  variant="secondary"
                >
                  Validar campos
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {provider === ConnectorProvider.GOOGLE_SHEETS && config ? (
        <Card>
          <CardHeader>
            <CardTitle>Conectar planilha do Google Sheets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {googleSheetsAccount ? (
              <div className="space-y-3">
                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-sm">
                  <p className="font-semibold">
                    {googleSheetsAccount.accountName ?? "Planilha vinculada"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Última sincronização:{" "}
                    {googleSheetsAccount.lastSyncedAt
                      ? new Date(
                          googleSheetsAccount.lastSyncedAt,
                        ).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })
                      : "ainda não sincronizada"}
                  </p>
                  {googleSheetsAccount.lastSyncError ? (
                    <ConnectorSyncError
                      error={googleSheetsAccount.lastSyncError}
                      provider={ConnectorProvider.GOOGLE_SHEETS}
                    />
                  ) : null}
                </div>
                <SyncNowButton
                  connectorAccountId={googleSheetsAccount.id}
                  label="Sincronizar agora"
                />
              </div>
            ) : (
              <form
                action="/api/connectors/manual"
                method="post"
                className="grid gap-4 md:grid-cols-[1fr_1fr_180px_auto]"
              >
                <input type="hidden" name="provider" value="GOOGLE_SHEETS" />
                <Input
                  label="Nome da planilha"
                  name="storeName"
                  placeholder="Ex: Vendas WhatsApp 2026"
                  required
                />
                <Input
                  label="URL da planilha"
                  name="baseUrl"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
                  required
                />
                <Input
                  label="GID da aba (opcional)"
                  name="ordersPath"
                  placeholder="já vem da URL"
                />
                <Button className="self-end" type="submit">
                  Conectar planilha
                </Button>
              </form>
            )}
            <p className="text-xs text-[var(--text-secondary)]">
              A planilha precisa estar com acesso &ldquo;Qualquer pessoa com o
              link pode visualizar&rdquo;. As colunas obrigatórias são{" "}
              <code>Dia</code>, <code>Qtd. Vendas</code> e{" "}
              <code>Valor em vendas</code>.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {config ? (
        <form action={deleteProviderConfigAction}>
          <input type="hidden" name="provider" value={provider} />
          <Button type="submit" variant="destructive">
            <Trash2 size={16} aria-hidden />
            Remover configuração
          </Button>
        </form>
      ) : null}
    </div>
  );
}
