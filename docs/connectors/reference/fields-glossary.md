# Glossário de Campos

Cada conector usa um subset desses campos no formulário de ProviderConfig. Termos com **(secreto)** vão pro Supabase Vault; os demais ficam em colunas planas.

| Campo | Tipo | Usado por | Descrição |
|---|---|---|---|
| `appId` | público | Meta Ads | App ID do Meta App em developers.facebook.com. |
| `appSecret` **(secreto)** | secreto | Meta Ads | App Secret do Meta App. |
| `clientId` | público | Google Ads, GA4, Nuvemshop | OAuth Client ID do Google Cloud / portal do provedor. |
| `clientSecret` **(secreto)** | secreto | Google Ads, GA4, Nuvemshop | OAuth Client Secret. |
| `developerToken` **(secreto)** | secreto | Google Ads | Developer token obtido via Google Ads API Center. |
| `loginCustomerId` | público | Google Ads | ID do MCC quando o gestor usa Manager Account. Sem hífen. |
| `apiKey` | público | Shopify, iSet, Tray, WBuy, Magazord | API key/token público do provedor. Em Shopify é o Client ID do app custom. |
| `apiSecret` **(secreto)** | secreto | Shopify, WBuy, Magazord | Secret pareado com `apiKey`. |
| `apiUser` | público | WBuy, Magazord | Usuário Basic Auth. |
| `apiPassword` **(secreto)** | secreto | WBuy, Magazord | Senha Basic Auth. |
| `baseUrl` | público | Manuais + Nuvemshop | URL base do API REST do provedor. Pra Google Sheets, a URL completa do spreadsheet. |
| `ordersPath` | público | Manuais | Path relativo do endpoint de pedidos. Pra Google Sheets, o `gid` da aba. |
| `apiVersion` | público | Meta Ads (`v25.0`), Shopify (`2026-04`), Google Ads (`v24`) | Versão da API a usar. Defaults definidos no código. |
| `redirectUri` | público | Todos OAuth | Callback URL que o provedor chama após autorização. Deve coincidir com o registrado no app externo. Padrão: `{NEXTAUTH_URL}/api/connectors/<provider>/callback`. |
| `scopes` | público | Meta, Google Ads, GA4, Shopify | Lista (CSV) de escopos OAuth solicitados. Defaults seguros já configurados. |
| `status` | público | Todos | `ACTIVE` ou `INACTIVE`. INACTIVE bloqueia novas conexões e sync. |
| `displayName` | público | Todos | Nome amigável exibido na UI. Opcional. |

---

## Defaults conhecidos

| Provider | Campo | Default no código |
|---|---|---|
| Meta Ads | `apiVersion` | `v25.0` ([src/lib/connectors/meta/oauth.ts](../../../src/lib/connectors/meta/oauth.ts)) |
| Meta Ads | `scopes` | `ads_read, ads_management, business_management, read_insights` |
| Google Ads | `apiVersion` | `v24` ([src/lib/connectors/google-ads/oauth.ts](../../../src/lib/connectors/google-ads/oauth.ts)) |
| Google Ads | `scopes` | `https://www.googleapis.com/auth/adwords` |
| GA4 | `scopes` | `https://www.googleapis.com/auth/analytics.readonly` |
| Shopify | `apiVersion` | `2026-04` ([src/lib/connectors/shopify/oauth.ts](../../../src/lib/connectors/shopify/oauth.ts)) |
| Shopify | `scopes` | `read_orders, read_products, read_customers, read_analytics` |
| Nuvemshop | `baseUrl` | `https://api.tiendanube.com/v1` |
| iSet | `baseUrl` sufixo | `/ws/v1` adicionado automaticamente |
| WBuy | `baseUrl` | `https://sistema.sistemawbuy.com.br/api/v1` |

---

## Como Vault funciona

Quando você salva um secret no form:
1. `saveProviderConfigAction` ([src/app/(app)/connectors/settings/actions.ts](../../../src/app/(app)/connectors/settings/actions.ts)) chama `upsertConnectorProviderConfig`.
2. `provider-config.ts` envia o valor pra `SupabaseVaultSecretStore.createSecret()` → retorna UUID.
3. Apenas o UUID é gravado em `ConnectorProviderConfig.secretRefs` (JSON: `{ "appSecret": "uuid", "clientSecret": "uuid", ... }`).
4. Pra usar, `getActiveProviderConfig()` chama `store.getSecret(uuid)` → decrypted on demand.

Logs e dumps **nunca** expõem o segredo decifrado. Mesmo `console.log(config)` mostra só os refs.
