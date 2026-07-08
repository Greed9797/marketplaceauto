import { ConnectorProvider } from "@prisma/client";

/**
 * A raw `lastSyncError` (provider API text, stack fragment, HTTP code) turned
 * into something a non-technical operator — or the client looking over their
 * shoulder — can act on at a glance. `detail` keeps the original string for
 * debugging; the UI shows it collapsed.
 */
export type FriendlySyncError = {
  /** Short headline: what went wrong, in plain pt-BR. */
  title: string;
  /** One line on what to do about it. */
  action: string;
  /** Original raw error, preserved for support/debugging. */
  detail: string;
};

const PROVIDER_LABEL: Record<ConnectorProvider, string> = {
  META_ADS: "Meta",
  GOOGLE_ADS: "Google Ads",
  GA4: "Google Analytics",
  SEARCH_CONSOLE: "Search Console",
  SHOPIFY: "Shopify",
  NUVEMSHOP: "Nuvemshop",
  ISET: "iSET",
  TRAY: "Tray",
  WBUY: "WBuy",
  MAGAZORD: "Magazord",
  GOOGLE_SHEETS: "Google Sheets",
  LOJA_INTEGRADA: "Loja Integrada",
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
  SHOPEE_ADS: "Shopee Ads",
  MERCADO_LIVRE_ADS: "Mercado Livre Ads",
  LEVANE: "Levane",
};

type Rule = {
  match: RegExp;
  title: string;
  action: (provider: string) => string;
};

// First matching rule wins, so order from most specific to most generic.
const RULES: ReadonlyArray<Rule> = [
  {
    // App removed / uninstalled / LGPD redact.
    match: /uninstall|desinstal|removeu o app|store\/redact|app\/uninstalled/i,
    title: "App desconectado na loja",
    action: (p) => `O app foi removido em ${p}. Reinstale e reconecte a conta.`,
  },
  {
    // Permission / scope not granted (Meta #200, Google PERMISSION_DENIED, 403).
    match:
      /\b403\b|permission|not grant|ads_management|ads_read|permission_denied|forbidden|insufficient|escopo|scope/i,
    title: "Permissão faltando",
    action: (p) =>
      `O dono da conta no ${p} precisa conceder acesso de leitura ao app. Peça a liberação e sincronize de novo.`,
  },
  {
    // Expired / invalid / missing token — needs reconnect.
    match:
      /\b401\b|invalid access token|invalid token|token.*(expired|missing|invalid|revoked)|unauthorized|refresh token|reauth|nao autoriz|não autoriz/i,
    title: "Acesso expirou",
    action: (p) =>
      `A conexão com o ${p} caiu. Reconecte a conta para voltar a sincronizar.`,
  },
  {
    // Provider returned an HTML login/consent page instead of JSON.
    match: /<!DOCTYPE|Unexpected token '<'|is not valid JSON|<html/i,
    title: "Acesso bloqueado pelo provedor",
    action: (p) =>
      `O ${p} respondeu com uma tela de login em vez dos dados. Reconecte a conta e confirme o acesso.`,
  },
  {
    // Rate limit.
    match: /\b429\b|rate limit|too many requests|quota|limite de requisi/i,
    title: "Limite de requisições atingido",
    action: () =>
      "O provedor pediu uma pausa. A sincronização tenta de novo em breve, sem ação necessária.",
  },
  {
    // Transient network / timeout / provider 5xx.
    match:
      /timeout|etimedout|econnreset|econnrefused|enotfound|network|socket hang up|\b50[0234]\b|temporariamente|service unavailable|bad gateway/i,
    title: "Instabilidade temporária",
    action: (p) =>
      `O ${p} ficou indisponível por um momento. Tente sincronizar de novo.`,
  },
  {
    // Not found — store/account/resource gone.
    match: /\b404\b|not found|nao encontrad|não encontrad|no such/i,
    title: "Conta ou recurso não encontrado",
    action: (p) =>
      `Não encontramos os dados no ${p}. Confira se a conta certa está conectada.`,
  },
  {
    // Missing provider configuration / credentials in the app.
    match:
      /missing.*config|provider.*config|credentials missing|secret not found|vault/i,
    title: "Configuração incompleta",
    action: (p) =>
      `Faltam credenciais do ${p} no app. Revise as configurações do conector.`,
  },
];

/**
 * Maps a raw connector sync error to a friendly, actionable message.
 * Never returns null for a non-empty error — falls back to a generic message.
 */
export function humanizeConnectorSyncError(
  raw: string,
  provider: ConnectorProvider,
): FriendlySyncError {
  const providerLabel = PROVIDER_LABEL[provider] ?? "provedor";

  for (const rule of RULES) {
    if (rule.match.test(raw)) {
      return {
        title: rule.title,
        action: rule.action(providerLabel),
        detail: raw,
      };
    }
  }

  return {
    title: "Erro ao sincronizar",
    action: `Tente sincronizar de novo. Se continuar, reconecte a conta no ${providerLabel}.`,
    detail: raw,
  };
}
