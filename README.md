# Adstart W3

SaaS B2B de marketing analytics para e-commerces, com dashboard unico de vendas, midia paga e performance operacional.

## Stack local

- Next.js 15 App Router
- React 19
- TypeScript estrito
- Tailwind CSS v4 com tokens W3 em CSS variables
- Prisma 5 preparado para PostgreSQL/Supabase
- Vitest + Testing Library
- Playwright

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

Abra `http://localhost:3000`.

## Scripts

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run e2e
```

## Producao publica

O dominio inicial de producao e `https://w3ads.vercel.app`. O passo a passo operacional fica em
`docs/production-runbook.md`.

Para producao real, configure no Vercel apenas envs de infraestrutura:

- Banco/Supabase: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
  No Supabase compartilhado `tuzoczzohirqddrcpbtc`, use `?schema=w3ads` nas URLs do Postgres.
- Auth: `AUTH_SECRET` ou `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://w3ads.vercel.app`, `AUTH_TRUST_HOST=true`, `AUTH_DISABLED=false`.
- Login Google: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- Redis/jobs: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- Observabilidade: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`.

Credenciais de conectores nao voltam para `.env`: Meta, Google Ads, Shopify, Nuvemshop, Tray, WBuy, iSet e Magazord sao configurados em `/connectors/settings` por um `W3_ADMIN` e gravados no Supabase Vault/KMS.

O build falha de proposito em production se `AUTH_DISABLED=true` ou se as envs criticas de auth/banco estiverem ausentes.

Antes do primeiro deploy com banco real, rode `supabase/bootstrap/w3ads-shared-project.sql` no projeto Supabase compartilhado. Isso cria o schema isolado `w3ads`, ajusta grants/search path sem tocar nos schemas `pulmao` e `saas`, habilita Vault e recarrega o cache do PostgREST.

## Auth e tenancy

- Email/senha usa sessao persistida na tabela `Session`, compativel com o cookie `authjs.session-token`.
- Google OAuth fica configurado via Auth.js + Prisma Adapter quando `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` existirem.
- Signup cria `User`, `Workspace`, `Membership(OWNER)` e dashboard padrao em transacao.
- Convites de workspace ficam em `WorkspaceInvite`; envio por email e no-op local enquanto `RESEND_API_KEY` nao estiver definida.
- RLS Supabase esta versionado nas migrations, com reforcos em `prisma/migrations/20260519121000_real_rbac_policies/migration.sql` para roles internos, `CLIENT` read-only e limite de um workspace por cliente. Em runtime, as rotas server-side tambem filtram explicitamente por `workspaceId`.

## Conector Meta Ads

A Fase 2 ja tem a base local do OAuth da Meta sem exigir Supabase real:

- `/api/connectors/meta/connect` gera `state` CSRF em cookie httpOnly e redireciona para o Facebook.
- `/api/connectors/meta/callback` valida `state` assinado e amarrado ao usuario/workspace e cria uma sessao temporaria de selecao para salvar apenas as contas de anuncio escolhidas.
- `src/lib/connectors/retry.ts` aplica retry exponencial com jitter e respeita `Retry-After`.
- `src/lib/connectors/meta/client.ts` troca `code` por token via POST, troca para long-lived token, lista ad accounts com `Authorization` header e pausa quando o header de uso da Meta passa do limite definido.
- Quando `INNGEST_EVENT_KEY` estiver configurada, cada conta conectada dispara backfill automatico de 90 dias.

Para testar conexao real depois de criar Supabase/Auth:

1. Aplique as migrations no Supabase/Postgres.
2. Ative a extensao Supabase Vault/KMS no projeto.
3. Acesse `/platform/bootstrap` para promover o primeiro usuario a `W3_ADMIN`.
4. Acesse `/connectors/settings` e cadastre as credenciais dos provedores no app.

O app nao desliga auth em producao. Para QA local, rode `npm run db:seed` e use `DEV_AUTH_BYPASS_EMAIL` apontando para um usuario seed; `AUTH_DISABLED` deve permanecer vazio ou `false`.

## Conectores Google Ads e Shopify

As bases das Fases 3 e 4 tambem estao preparadas sem chamar providers em ambiente sem credenciais:

- Google Ads usa OAuth offline, `customers:listAccessibleCustomers`, expansao de hierarquia via `customer_client`, selecao apenas de contas anunciante, GAQL via REST, refresh automatico do access token e job Inngest `connector.google_ads.backfill`.
- Shopify usa OAuth com validacao HMAC, GraphQL Orders, registro dos webhooks `orders/create`, `orders/updated`, `orders/paid` e `app/uninstalled`, webhook assinado em `/api/webhooks/shopify` e job `connector.shopify.backfill`.
- Nuvemshop usa OAuth oficial, token sem expiracao e `user_id` como loja; pedidos entram no job generico `connector.ecommerce.backfill`.
- iSet, Tray, WBuy e Magazord usam conexao manual REST: URL da API, caminho de pedidos e credenciais sao validados antes de salvar.
- Tokens OAuth, API keys, usuarios/senhas, developer tokens e webhook secrets ficam no Supabase Vault/KMS.
- `ConnectorProviderConfig` guarda apenas campos publicos do app/API por workspace.
- `ConnectorAccount` usa `credentialSecretId` e `refreshCredentialSecretId` para novas conexoes; os campos AES antigos continuam como fallback legado.
- O state de todos os conectores e assinado com `AUTH_SECRET` ou `NEXTAUTH_SECRET`; em producao configure pelo menos um segredo forte.
- Nao existem mais envs obrigatorias `META_*`, `GOOGLE_ADS_*`, `SHOPIFY_*` ou `NUVEMSHOP_*`.

## Jobs e operacao

- `sync-active-connectors-daily` roda no Inngest as `09:00 UTC` (`06:00 BRT`).
- Ads fazem incremental dos ultimos 7 dias.
- E-commerces fazem incremental dos ultimos 3 dias.
- `SyncJob` registra `workspaceId`, `provider`, `syncType`, `cursor`, status, contadores e erro.
- `/api/health` valida modo de auth, banco, Vault, Inngest e Redis sem expor segredos.
- Rate limit via Upstash protege auth, callbacks de conector, webhooks e conectores manuais.

## CI e gates

O workflow `.github/workflows/ci.yml` roda em PR/push:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
npm audit --audit-level=high
```

O deploy para production deve acontecer somente depois desses gates e das envs reais no Vercel.

## Dashboard core

A rota `/dashboard` usa `src/lib/metrics/aggregator.ts` para calcular:

- Faturamento por `EcommerceOrder.orderTotal`
- Investimento por `DailyMetric.spend`
- ROAS blended
- Pedidos
- Serie diaria de faturamento x investimento
- Top 10 campanhas por ROAS
- Funil de impressoes, cliques, sessoes e pedidos

O dashboard nao inventa dados para preencher visual. Sem `EcommerceOrder`, `EcommerceOrderItem` e `DailyMetric` reais no periodo, a UI exibe empty states claros.

## Dashboards customizaveis

A rota `/dashboards` lista paineis do workspace e `/dashboards/new` cria dashboards com widgets selecionados do catalogo MVP em `src/lib/metrics/kpi-catalog.ts`.

- 12 widgets disponiveis: KPIs, grafico receita x investimento, tabela de campanhas, funil e distribuicao de fonte.
- `/dashboards/[id]` permite adicionar, remover e ordenar widgets por botoes de subir/descer.
- OWNER e ADMIN editam; VIEWER apenas consulta.
- Dashboards customizados persistem em `Dashboard.layout` e `Dashboard.widgets` no Prisma.

## LGPD e beta polish

- `/profile` centraliza conta, privacidade, exportacao e exclusao.
- `/profile/data-export` gera JSON baixavel e registra solicitacao em audit log quando o banco esta ativo.
- `/profile/delete-account` exige confirmacao exata por email; em banco real marca `User.deletedAt` e encerra sessoes.
- Cookie banner e onboarding de 3 passos rodam no client sem dependencia externa.
- `/api/health` retorna health granular de auth, DB, Vault, Inngest e Redis.
- `/feedback` coleta problemas, duvidas e sugestoes do beta com usuario autenticado,
  com banco ativo persiste em `BetaFeedback` e grava audit log.
- `NEXT_PUBLIC_POSTHOG_KEY` habilita envio opcional para a Capture API do PostHog.
- `SENTRY_DSN` e `NEXT_PUBLIC_SENTRY_DSN` ativam o SDK oficial `@sentry/nextjs` para front, back e edge.
- Erros capturados no client sao enviados para `/api/observability/client-error`; quando o banco
  responde sem tocar no banco, com Supabase ativo grava `AuditLog`.
- `NEXT_PUBLIC_POSTHOG_KEY` habilita dispatch local de eventos seguros, sem PII.

## Design system W3

Os tokens centrais ficam em `src/app/globals.css`. Componentes React devem consumir CSS variables, evitando hexadecimais fixos fora de assets como `public/logo-w3.svg`.
