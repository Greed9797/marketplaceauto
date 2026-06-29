# Variáveis de Ambiente — Conectores

Lista completa de env vars relacionadas a conectores e infra que eles dependem. Validador em [scripts/validate-production-env.mjs](../../../scripts/validate-production-env.mjs) — rode `node scripts/validate-production-env.mjs` antes de qualquer deploy.

---

## Críticas (boot falha sem elas em produção)

| Var | Onde usada | Como gerar |
|---|---|---|
| `DATABASE_URL` | Prisma client + pooler Supabase | Connection pooler URL (porta 6543) com `?schema=w3ads&pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Prisma migrate / session pooler | URL porta 5432 + `?schema=w3ads` |
| `AUTH_SECRET` (ou `NEXTAUTH_SECRET`) | NextAuth JWT signing | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Base pra redirect URIs OAuth | `https://app.w3ads.com.br` |
| `AUTH_TRUST_HOST` | NextAuth confia no host | `true` |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM dos tokens OAuth | `openssl rand -base64 32` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Vault + storage | Project Settings → API no Supabase |

Boot do app chama [instrumentation.ts](../../../instrumentation.ts) que invoca `getTokenEncryptionKey()` — se ausente em prod, o processo nem sobe.

---

## OAuth providers

| Var | Provider | Obtida em |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | GA4 (NextAuth login + GA4 connector) | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | GA4 | idem |

Demais credenciais OAuth (Meta `appId/appSecret`, Google Ads, Shopify, Nuvemshop) **não são env vars** — são salvas via UI em `/connectors/settings/<provider>` e vivem no Supabase Vault. Veja [fields-glossary.md](./fields-glossary.md).

---

## Sincronização (Inngest)

| Var | Propósito |
|---|---|
| `INNGEST_EVENT_KEY` | Autoriza emissão de eventos. Sem isso, sync **não dispara** após connect. |
| `INNGEST_SIGNING_KEY` | Valida que webhooks recebidos pelo `/api/inngest` vêm do Inngest. |

Em dev, `npx inngest-cli dev` cria um dev server e ignora as chaves; em prod ambos são obrigatórios.

---

## Email / Notificações

| Var | Propósito |
|---|---|
| `RESEND_API_KEY` | Envio de convites e reset password |
| `RESEND_FROM_EMAIL` | Endereço remetente (formato `"Nome <email@dominio>"`) |

---

## Cache / Rate limit

| Var | Propósito |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Backing do `@upstash/ratelimit` |
| `UPSTASH_REDIS_REST_TOKEN` | idem |

---

## Observabilidade

| Var | Propósito |
|---|---|
| `SENTRY_DSN` (ou `NEXT_PUBLIC_SENTRY_DSN`) | Captura de erros server/edge/client |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics de produto |

---

## Dev-only

| Var | Default | Quando setar |
|---|---|---|
| `DEV_AUTH_BYPASS_EMAIL` | unset | Em local, pula login NextAuth e loga como o usuário com esse email. **Inativo em produção** independente do valor. Veja [src/lib/auth/mode.ts](../../../src/lib/auth/mode.ts). |

---

## Exemplo `.env` de produção (mínimo viável)

```bash
NODE_ENV=production
DATABASE_URL="postgresql://postgres.xxxxx:[PASS]@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?schema=w3ads&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.xxxxx:[PASS]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?schema=w3ads"
AUTH_SECRET="..."
AUTH_TRUST_HOST="true"
NEXTAUTH_URL="https://app.w3ads.com.br"
TOKEN_ENCRYPTION_KEY="..."
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."
GOOGLE_OAUTH_CLIENT_ID="..."
GOOGLE_OAUTH_CLIENT_SECRET="..."
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="W3ADS <no-reply@w3educacao.com.br>"
UPSTASH_REDIS_REST_URL="https://...upstash.io"
UPSTASH_REDIS_REST_TOKEN="..."
INNGEST_EVENT_KEY="..."
INNGEST_SIGNING_KEY="signkey_..."
SENTRY_DSN="https://...@sentry.io/..."
NEXT_PUBLIC_POSTHOG_KEY="phc_..."
```

Use `node scripts/validate-production-env.mjs` antes do deploy.
