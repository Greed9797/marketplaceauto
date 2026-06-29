# Conceitos Fundamentais

Este documento explica os blocos arquiteturais que aparecem em todos os conectores. Leia antes de mergulhar em um conector específico.

---

## Hierarquia de dados

```
Workspace                                          (tenant)
   │
   ├── ConnectorProviderConfig (1 por provider)    Master cadastra
   │     ├── publicCredentials  (appId, clientId)
   │     ├── secretRefs         → Supabase Vault
   │     ├── redirectUri, scopes, apiVersion
   │     └── status: ACTIVE | INACTIVE | ERROR
   │
   ├── ConnectorAccount (N por provider)           Cliente/Gestor conecta
   │     ├── externalAccountId  (page id, store id, property id...)
   │     ├── accessToken/refreshToken cifrados
   │     ├── lastSyncedAt, lastSyncError
   │     └── status: ACTIVE | INACTIVE | ERROR
   │
   ├── SyncJob (N por ConnectorAccount)            Inngest executa
   │     ├── syncType: BACKFILL | INCREMENTAL
   │     ├── range: { since, until }
   │     └── status: PENDING | RUNNING | COMPLETED | FAILED
   │
   ├── DailyMetric                                 alimenta KPIs
   └── EcommerceOrder + EcommerceOrderItem         alimenta tabelas comércio
```

Schema autoritativo: [prisma/schema.prisma](../../prisma/schema.prisma).

---

## OAuth vs Manual

| Modo | Quem | Como salva credencial |
|---|---|---|
| **OAuth** | Meta, Google Ads, GA4, Shopify, Nuvemshop | Usuário aprova app W3 no provedor → recebemos `access_token` + `refresh_token` cifrados. |
| **Manual** | iSet, Tray, WBuy, Magazord, Google Sheets | Usuário cola API key / user+password / URL da planilha. Validamos com `healthCheck()` antes de salvar. |

Registry: [src/lib/connectors/registry.ts](../../src/lib/connectors/registry.ts) → `CONNECTOR_PROVIDER_DEFINITIONS`.

---

## Fluxo OAuth (passo a passo)

1. **Master cadastra ProviderConfig** em `/connectors/settings/<provider>`:
   - Public: `appId`/`clientId`, `redirectUri`, `apiVersion`, `scopes`
   - Secret: `appSecret`/`clientSecret`/`developerToken` → Supabase Vault
   - Server action: [src/app/(app)/connectors/settings/actions.ts](../../src/app/(app)/connectors/settings/actions.ts) `saveProviderConfigAction`
2. **Usuário clica "Conectar"** em `/connectors`:
   - GET `/api/connectors/<provider>/connect`
   - Server gera `state` aleatório, salva em cookie HttpOnly (`adstart_<provider>_oauth_state`)
   - Redirect pra URL de autorização do provedor (ex: `https://www.facebook.com/v25.0/dialog/oauth?...`)
3. **Usuário aprova no provedor** → provedor redireciona pra `/api/connectors/<provider>/callback?code=...&state=...`
4. **Callback do W3**:
   - Valida `state` contra cookie (CSRF)
   - Troca `code` por `access_token` + `refresh_token`
   - Cria `ConnectorSelectionSession` (lista de contas/lojas disponíveis)
   - Redirect pra `/connectors/select?session=<id>`
5. **Usuário escolhe quais contas vincular** → POST `/api/connectors/select`:
   - Cria `ConnectorAccount` pra cada conta selecionada
   - Emite evento Inngest `connector.<provider>.backfill`

State cookie tem TTL de 10 minutos.

---

## Fluxo Manual (passo a passo)

1. **Master cadastra ProviderConfig** com URL base do API e (se aplicável) defaults de path/headers.
2. **Usuário preenche form inline em `/connectors`**:
   - Campos: `baseUrl`, `ordersPath`, `apiUser`, `apiPassword`, `apiKey`, `apiSecret`
   - Submit → POST `/api/connectors/manual`
3. **Server `healthCheck`** em [src/lib/connectors/manual-commerce-client.ts](../../src/lib/connectors/manual-commerce-client.ts) — chama endpoint de pedidos com `limit=1`. Se 200, prossegue.
4. **Cria ConnectorAccount** + emite `connector.ecommerce.backfill`.

---

## Vault de segredos

- `secretRefs` no DB guarda apenas IDs UUID; valores reais vivem no Supabase Vault (extensão `vault`).
- Implementação: [src/lib/security/secret-store.ts](../../src/lib/security/secret-store.ts) `SupabaseVaultSecretStore`.
- Em testes (`NODE_ENV=test`), substituído por `MemorySecretStore` em memória.
- OAuth tokens (`accessToken`, `refreshToken`) usam AES-256-GCM via [src/lib/crypto/token-vault.ts](../../src/lib/crypto/token-vault.ts) — chave em `TOKEN_ENCRYPTION_KEY` (32 bytes base64). Fail-fast no boot prod via [instrumentation.ts](../../instrumentation.ts).

---

## Sincronização (Inngest)

| Provider | Evento emitido após connect | Janela backfill |
|---|---|---|
| Meta Ads | `connector.meta.backfill` | 90d |
| Google Ads | `connector.google_ads.backfill` | 90d |
| GA4 | `connector.google_analytics.backfill` | 90d |
| Shopify | `connector.shopify.backfill` | 60d ou 90d (depende de `read_all_orders`) |
| Nuvemshop | `connector.ecommerce.backfill` | 30d |
| iSet/Tray/WBuy/Magazord/Sheets | `connector.ecommerce.backfill` | 30d |

Definições: [src/lib/connectors/backfill.ts](../../src/lib/connectors/backfill.ts).

Sync diário agendado: roda à 00:00 UTC, intervalo incremental (últimos 3-7 dias dependendo do tipo).

---

## RBAC dos conectores

| Capabilities | Função |
|---|---|
| `canManageProviderConfigs` | Master + Gestor de Contas. Cadastrar/editar/remover apps. |
| `canAddWorkspaceConnectors` | Master, Gestor de Contas, OWNER, ADMIN, CLIENT. Conectar contas. |
| `canDeleteWorkspaceConnectors` | Master, Gestor de Contas, OWNER, ADMIN. CLIENT **não** pode. |
| Gestor de Tráfego | Bloqueado de tudo (add + delete + config). |

Fonte: [src/lib/auth/platform-permissions.ts](../../src/lib/auth/platform-permissions.ts).

---

## Erros comuns

URLs do tipo `/connectors?error=<code>` indicam falha. Tabela completa em [faq-troubleshooting.md](./faq-troubleshooting.md).
