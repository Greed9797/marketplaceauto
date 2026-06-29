"use client";

import { KeyRound, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { connectMetaSystemUserAction } from "@/app/(app)/connectors/meta-system-user-action";
import { saveProviderConfigAction } from "@/app/(app)/connectors/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicProviderConfig } from "@/lib/connectors/provider-config";

type Mode = "system-user" | "oauth";

type MetaProviderSettingsProps = {
  config: PublicProviderConfig | null;
  /** When true, the official Meta access token is set via env — field optional. */
  accessTokenPreset?: boolean;
};

const PROVIDER_VALUE = "META_ADS";
const INPUT_CLASS =
  "h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

export function MetaProviderSettings({
  config,
  accessTokenPreset = false,
}: MetaProviderSettingsProps) {
  const hasOauthCreds = Boolean(
    config?.publicCredentials.appId ||
    config?.configuredSecretKeys.includes("appSecret"),
  );
  const [mode, setMode] = useState<Mode>(
    hasOauthCreds ? "oauth" : "system-user",
  );
  const apiVersion = config?.apiVersion ?? "v25.0";
  const scopes =
    config?.scopes ??
    "ads_read,ads_management,business_management,read_insights";
  const displayName = config?.displayName ?? "Meta Ads";
  const leadEventId = config?.publicCredentials.leadEventId ?? "";
  const scheduledEventId = config?.publicCredentials.scheduledEventId ?? "";

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Conectar conta Meta Ads</CardTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            Escolha o método de autenticação. System User Token é o caminho
            recomendado para o MVP — não exige Redirect URI nem configuração de
            app OAuth.
          </p>
        </CardHeader>
        <CardContent>
          <div
            className="mb-4 inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1"
            role="tablist"
          >
            <TabButton
              active={mode === "system-user"}
              icon={<KeyRound size={14} aria-hidden="true" />}
              onClick={() => setMode("system-user")}
            >
              System User Token (MVP)
            </TabButton>
            <TabButton
              active={mode === "oauth"}
              icon={<Settings2 size={14} aria-hidden="true" />}
              onClick={() => setMode("oauth")}
            >
              OAuth (avançado)
            </TabButton>
          </div>

          {mode === "system-user" ? (
            <form action={connectMetaSystemUserAction} className="grid gap-4">
              <Hint>
                Gere um System User Token no Meta Business Manager →
                Configurações do negócio → Usuários do sistema → Gerar novo
                token (scope{" "}
                <code className="rounded bg-[var(--bg-elevated)] px-1">
                  ads_read
                </code>
                ).
              </Hint>
              <FieldLabel
                label="Access Token"
                helper={
                  accessTokenPreset
                    ? "Token oficial W3 Ads já configurado. Preencha só para trocar."
                    : "System User token gerado no Business Manager."
                }
              >
                <input
                  className={INPUT_CLASS}
                  name="accessToken"
                  placeholder={accessTokenPreset ? "Já configurado" : "EAAB..."}
                  required={!accessTokenPreset}
                  type="password"
                />
              </FieldLabel>
              <FieldLabel
                label="Ad Account ID"
                helper="Apenas os dígitos. Não inclua o prefixo act_."
              >
                <input
                  className={INPUT_CLASS}
                  name="adAccountId"
                  placeholder="1234567890"
                  required
                />
              </FieldLabel>
              <FieldLabel
                label="Nome da conta (opcional)"
                helper="Identificação amigável na lista de contas conectadas."
              >
                <input
                  className={INPUT_CLASS}
                  name="accountName"
                  placeholder="Cliente XPTO — Meta"
                />
              </FieldLabel>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button type="submit">Conectar conta</Button>
              </div>
            </form>
          ) : (
            <form action={saveProviderConfigAction} className="grid gap-4">
              <input type="hidden" name="provider" value={PROVIDER_VALUE} />
              <input type="hidden" name="status" value="ACTIVE" />
              <input type="hidden" name="displayName" value={displayName} />
              <input type="hidden" name="leadEventId" value={leadEventId} />
              <input
                type="hidden"
                name="scheduledEventId"
                value={scheduledEventId}
              />
              <Hint>
                Use o fluxo OAuth quando o cliente final autoriza pela própria
                conta Meta. Exige App ID, App Secret e Redirect URI cadastrados
                no Meta for Developers.
              </Hint>
              <div className="grid gap-4 lg:grid-cols-2">
                <FieldLabel label="Meta App ID">
                  <input
                    className={INPUT_CLASS}
                    name="appId"
                    defaultValue={config?.publicCredentials.appId ?? ""}
                    required
                  />
                </FieldLabel>
                <FieldLabel label="Meta App Secret">
                  <input
                    className={INPUT_CLASS}
                    name="appSecret"
                    placeholder={
                      config?.configuredSecretKeys.includes("appSecret")
                        ? "Já configurado. Preencha só para trocar."
                        : "Obrigatório"
                    }
                    type="password"
                  />
                </FieldLabel>
                <FieldLabel label="API version">
                  <input
                    className={INPUT_CLASS}
                    name="apiVersion"
                    defaultValue={apiVersion}
                  />
                </FieldLabel>
                <FieldLabel label="Redirect URI">
                  <input
                    className={INPUT_CLASS}
                    name="redirectUri"
                    defaultValue={config?.redirectUri ?? ""}
                    placeholder="https://app.exemplo.com/api/connectors/meta/callback"
                    required
                  />
                </FieldLabel>
                <FieldLabel label="Scopes">
                  <input
                    className={INPUT_CLASS}
                    name="scopes"
                    defaultValue={scopes}
                  />
                </FieldLabel>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button type="submit">Salvar configuração OAuth</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos do Pixel (opcional)</CardTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            Mapeie IDs de pixel customizado para enriquecer leads e agendamentos
            no dashboard. Aplica-se a ambos os modos de conexão.
          </p>
        </CardHeader>
        <CardContent>
          <form action={saveProviderConfigAction} className="grid gap-4">
            <input type="hidden" name="provider" value={PROVIDER_VALUE} />
            <input type="hidden" name="status" value="ACTIVE" />
            <input type="hidden" name="displayName" value={displayName} />
            <input type="hidden" name="apiVersion" value={apiVersion} />
            <input type="hidden" name="scopes" value={scopes} />
            <input
              type="hidden"
              name="appId"
              value={config?.publicCredentials.appId ?? ""}
            />
            <input
              type="hidden"
              name="redirectUri"
              value={config?.redirectUri ?? ""}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <FieldLabel
                label="Pixel event ID — Lead"
                helper="Ex: 823314883920077"
              >
                <input
                  className={INPUT_CLASS}
                  name="leadEventId"
                  defaultValue={leadEventId}
                  placeholder="Opcional"
                />
              </FieldLabel>
              <FieldLabel
                label="Pixel event ID — Agendamento"
                helper="Ex: 823314883920077"
              >
                <input
                  className={INPUT_CLASS}
                  name="scheduledEventId"
                  defaultValue={scheduledEventId}
                  placeholder="Opcional"
                />
              </FieldLabel>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" variant="secondary">
                Salvar eventos do Pixel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function TabButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {icon}
      {children}
    </button>
  );
}

function FieldLabel({
  children,
  helper,
  label,
}: {
  children: ReactNode;
  helper?: string;
  label: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-caption text-[var(--text-tertiary)]">{label}</span>
      {children}
      {helper ? (
        <span className="text-xs text-[var(--text-tertiary)]">{helper}</span>
      ) : null}
    </label>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
      {children}
    </div>
  );
}
