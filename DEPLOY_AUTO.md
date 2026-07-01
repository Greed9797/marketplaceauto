# Deploy no domínio do auto (marketplace-publisher.vercel.app)

O app merged (W3-Marketplace + publicador) está pronto na branch
`w3-marketplace-merge` deste repo. Para ir ao ar no domínio do auto (onde os
redirects OAuth Shopee/ML já estão registrados), no projeto Vercel
**marketplace-publisher**:

## 1. Environment Variables (Production) — adicionar
Manter as que já existem (`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`,
`ML_APP_ID`, `ML_SECRET`, `GEMINI_API_KEY`, `SESSION_SECRET`) e ADICIONAR:

- `DATABASE_URL`  = Postgres W3 Geral, **pooled** (6543/pgbouncer), `?schema=w3marketplace`
- `DIRECT_URL`    = Postgres W3 Geral, **direto** (5432), `?schema=w3marketplace`
- `SUPABASE_URL` = https://tuzoczzohirqddrcpbtc.supabase.co
- `SUPABASE_ANON_KEY` = (anon/publishable do projeto)
- `SUPABASE_SERVICE_ROLE_KEY` = (service_role)
- `AUTH_SECRET` = (32+ chars) · `NEXTAUTH_SECRET` = igual ao AUTH_SECRET
- `NEXTAUTH_URL` = https://marketplace-publisher.vercel.app
- `AUTH_TRUST_HOST` = true · `AUTH_DISABLED` = false
- `TOKEN_ENCRYPTION_KEY` = (32-byte base64) · `CRON_SECRET` = (random)
- `MARKETPLACE_FIRST` = true
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- `SHOPEE_REDIRECT_URI` = https://marketplace-publisher.vercel.app/api/auth/shopee/callback
- `ML_REDIRECT_URI`     = https://marketplace-publisher.vercel.app/api/auth/ml/callback

> Os mesmos valores estão no `.env` local do W3-Marketplace (menos os OAuth do auto).

## 2. Git
Settings → Git → **Production Branch** = `w3-marketplace-merge`
(ou fazer merge dessa branch no `main`).

## 3. Redeploy
Deployments → Redeploy. O build roda `prisma migrate deploy` (já baselinado no
w3marketplace, no-op) + `next build`. Ao subir, `/api/health` = 200.

## 4. Habilitar APIs nos apps existentes (pra funcionar de verdade)
- **Shopee** (Open Platform): habilitar a categoria **Order** (além de produto) —
  pra ler pedidos além de publicar.
- **Mercado Livre**: escopo **read** (já pedimos `offline_access read` na URL).

Pronto: conectar loja Shopee/ML por cliente funciona no domínio do auto.
