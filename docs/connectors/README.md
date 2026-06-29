# Conectores W3ADS — Documentação

Guia completo de como configurar, conectar e operar os conectores de dados do W3ADS. Cada provedor tem um documento dedicado com setup externo (Meta/Google/etc), preenchimento na UI, fluxo de sincronização e troubleshooting.

> **Quem deve ler:** Master, Gestor de Contas e clientes em onboarding. Para conceitos arquiteturais (OAuth state, vault, Inngest, RBAC), comece por [concepts.md](./concepts.md).

---

## Provedores suportados

| Conector | Categoria | Modo | Documento |
|---|---|---|---|
| Meta Ads | Ads | OAuth | [oauth/meta-ads.md](./oauth/meta-ads.md) |
| Google Ads | Ads | OAuth | [oauth/google-ads.md](./oauth/google-ads.md) |
| Google Analytics (GA4) | Analytics | OAuth | [oauth/google-analytics.md](./oauth/google-analytics.md) |
| Shopify | E-commerce | OAuth | [oauth/shopify.md](./oauth/shopify.md) |
| Nuvemshop | E-commerce | OAuth | [oauth/nuvemshop.md](./oauth/nuvemshop.md) |
| iSet | E-commerce | Manual (API key) | [manual/iset.md](./manual/iset.md) |
| Tray | E-commerce | Manual (access token) | [manual/tray.md](./manual/tray.md) |
| WBuy | E-commerce | Manual (Basic Auth / token) | [manual/wbuy.md](./manual/wbuy.md) |
| Magazord | E-commerce | Manual (Basic + X-Api-Token) | [manual/magazord.md](./manual/magazord.md) |
| Google Sheets / WhatsApp | E-commerce | Manual (CSV público) | [manual/google-sheets.md](./manual/google-sheets.md) |

Definição autoritativa em [src/lib/connectors/registry.ts](../../src/lib/connectors/registry.ts).

---

## Fluxo geral

```
┌──────────────────────────────┐
│ 1. Master cadastra app/keys  │  /connectors/settings/<provider>
│    (ProviderConfig)          │  → criptografado no vault Supabase
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ 2. Cliente/Gestor conecta    │  /connectors → "Conectar <Provider>"
│    conta/loja (Account)      │  → OAuth flow ou form manual
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ 3. Inngest faz backfill      │  evento connector.<provider>.backfill
│    e sync diário             │  → DailyMetric + EcommerceOrder
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ 4. Dashboard mostra KPIs     │  /dashboard
└──────────────────────────────┘
```

Detalhes da arquitetura em [concepts.md](./concepts.md).

---

## Quem pode fazer o quê

| Ação | Master | Gestor de Contas | Gestor de Tráfego | Cliente |
|---|:---:|:---:|:---:|:---:|
| Cadastrar ProviderConfig (app/keys) | ✅ | ✅ | ❌ | ❌ |
| Conectar conta/loja (Add) | ✅ | ✅ | ❌ | ✅ |
| Remover conta/loja (Delete) | ✅ | ✅ | ❌ | ❌ |
| Ver dashboard | ✅ | ✅ | ✅ | ✅ |

Matriz completa em [reference/permissions.md](./reference/permissions.md). Fonte: [src/lib/auth/platform-permissions.ts](../../src/lib/auth/platform-permissions.ts).

---

## Pré-requisitos

Antes de qualquer conector funcionar em produção:

1. **Env vars críticas** configuradas (TOKEN_ENCRYPTION_KEY, AUTH_SECRET, INNGEST_*, etc.) — veja [reference/env-vars.md](./reference/env-vars.md).
2. **Inngest** rodando (dev: `npx inngest-cli dev`; prod: registrado em inngest.com).
3. **Supabase Vault** habilitado no projeto Postgres (extension `vault`).
4. **NEXTAUTH_URL** apontando pro host correto, pois redirect URIs OAuth derivam dele.

Validação automática:
```bash
node scripts/validate-production-env.mjs
```

---

## Glossário rápido

- **ProviderConfig** — chave/segredo do app W3 no provedor externo. Um por workspace+provider.
- **ConnectorAccount** — uma conta/loja específica conectada (ex: uma página Meta, uma loja Shopify).
- **SyncJob** — registro de execução de backfill/sync. Status: PENDING, RUNNING, COMPLETED, FAILED.
- **DailyMetric** — métricas agregadas por dia/provider que alimentam o dashboard.
- **EcommerceOrder** — pedidos normalizados de provedores commerce.

Glossário detalhado em [reference/fields-glossary.md](./reference/fields-glossary.md).

---

## Troubleshooting

Erros comuns e como diagnosticar: [faq-troubleshooting.md](./faq-troubleshooting.md).
