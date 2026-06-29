# W3ADS Production Runbook

Dominio inicial: `https://w3ads.vercel.app`.

Este runbook fecha a ordem operacional para sair do ambiente local e abrir producao publica com Supabase, Vault, auth real, jobs e conectores configuraveis no app.

## 1. Supabase production compartilhado

Projeto Supabase: `tuzoczzohirqddrcpbtc`.

Este projeto ja compartilha `auth.users`, storage, edge functions e os schemas `pulmao` e `saas`.
O W3ADS deve usar schema isolado `w3ads`, nunca `public`, para nao colidir com os apps existentes.

1. Confirme que o schema `w3ads` nao existe com objetos conflitantes.
2. Rode o bootstrap seguro:

```sql
-- arquivo local
supabase/bootstrap/w3ads-shared-project.sql
```

3. Configure `DATABASE_URL` e `DIRECT_URL` com `?schema=w3ads`.
4. Habilite Vault/KMS no projeto se ainda nao estiver ativo.
5. Copie `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
6. Aplique migrations:

```bash
npx prisma migrate deploy
npx prisma generate
```

5. Verifique o Vault:

```sql
select to_regclass('vault.secrets');
```

O resultado esperado e `vault.secrets`. Se vier `null`, os conectores nao podem salvar segredos.

Depois de qualquer DDL, execute:

```sql
NOTIFY pgrst, 'reload schema';
```

## 2. Vercel envs obrigatorias

Adicionar em Production no projeto Vercel:

```bash
DATABASE_URL=postgresql://.../postgres?schema=w3ads
DIRECT_URL=postgresql://.../postgres?schema=w3ads
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AUTH_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://w3ads.vercel.app
AUTH_TRUST_HOST=true
AUTH_DISABLED=false
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
RESEND_API_KEY=
RESEND_FROM_EMAIL=Adstart W3 <no-reply@w3educacao.com.br>
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
POSTHOG_API_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

Fluxo recomendado sem expor segredos no chat:

1. Copie `.env.example` para `.env.production.local`.
2. Preencha os valores reais localmente no seu Mac.
3. Rode:

```bash
npm run vercel:env:push
```

O script remove e recria as envs no ambiente `production` da Vercel sem imprimir os valores no terminal.

`AUTH_DISABLED=true` em production bloqueia o build. Essa trava e intencional.

Credenciais de Meta, Google Ads, Shopify, Nuvemshop, Tray, WBuy, iSet e Magazord nao entram em env. Elas devem ser criadas em `/connectors/settings` por um `W3_ADMIN` e salvas no Supabase Vault.

## 3. Bootstrap do primeiro W3_ADMIN

1. Acesse `/sign-up` e crie o primeiro usuario real.
2. Acesse `/platform/bootstrap`.
3. Promova esse usuario para `W3_ADMIN`.
4. Acesse `/connectors/settings`.
5. Cadastre cada provedor por workspace.

Depois que existir um `W3_ADMIN`, novos admins internos devem ser promovidos no banco ou por ferramenta administrativa controlada.

## 4. Redirect URIs de producao

Configure nos portais oficiais:

```text
https://w3ads.vercel.app/api/auth/callback/google
https://w3ads.vercel.app/api/connectors/meta/callback
https://w3ads.vercel.app/api/connectors/google-ads/callback
https://w3ads.vercel.app/api/connectors/shopify/callback
https://w3ads.vercel.app/api/connectors/nuvemshop/callback
```

Quando entrar dominio customizado, todos esses redirects precisam ser atualizados antes da troca publica.

## 5. Jobs e sync

O job `sync-active-connectors-daily` roda via Inngest as `09:00 UTC`, equivalente a `06:00 BRT`.

Janelas incrementais:

- Ads: ultimos 7 dias, para capturar consolidacao tardia de plataformas.
- E-commerce: ultimos 3 dias, para capturar pedidos alterados, pagos ou cancelados depois.

Backfill inicial continua por evento especifico de conector. Para reprocessar:

1. Abra Inngest.
2. Reenvie o evento `connector.<provider>.backfill`.
3. Use `syncType=BACKFILL` para carga inicial ou `syncType=MANUAL` para correcao controlada.
4. Monitore `SyncJob` por `workspaceId`, `provider`, `status` e `startedAt`.

## 6. Smoke de producao

Rodar depois de cada deploy:

```bash
curl -I https://w3ads.vercel.app/login
curl -s https://w3ads.vercel.app/api/health | jq .
```

Fluxo manual minimo:

1. `/sign-up`
2. `/login`
3. `/dashboard`
4. `/connectors`
5. `/connectors/settings` com usuario `W3_ADMIN`
6. Configurar um provedor
7. Conectar e selecionar uma conta/loja
8. Confirmar `ConnectorAccount.status=ACTIVE`
9. Confirmar `SyncJob.status=SUCCESS`
10. Confirmar dashboard com dados reais

## 7. Comandos de gate

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
npm audit --audit-level=high
```

O deploy para Vercel Production so deve ser feito quando esses gates passarem e as envs obrigatorias estiverem preenchidas.

## 8. Pausar conector problemático

1. Atualize `ConnectorAccount.status` para `ERROR` ou `REVOKED`.
2. Registre o motivo em `lastSyncError`.
3. Se o problema for configuracao do provider, marque `ConnectorProviderConfig.status=ERROR`.
4. Corrija credenciais em `/connectors/settings`.
5. Rode health check do conector.
6. Volte para `ACTIVE` apenas depois de sync manual com sucesso.

## 9. Limitacoes antes da abertura publica

- Validacao final de Meta/Google/Shopify/Nuvemshop exige contas reais e permissões aprovadas nos portais.
- Tray, WBuy, iSet e Magazord devem entrar em piloto por provedor antes de escala.
- Termos, politica de privacidade e DPO precisam de revisao juridica antes de trafego publico amplo.
