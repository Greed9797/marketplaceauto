# W3ADS — Roadmap de Produção

> Auditoria de production-readiness da W3ADS (Next.js 15 App Router · Prisma 5 · Supabase Postgres · Vercel) contra os frameworks que grandes SaaS globais usam para validar projetos: **Google SRE Production Readiness Review**, **AWS Well-Architected**, **OWASP Top 10 / ASVS L2**, **DORA Four Keys**, **SOC2 / ISO 27001 / LGPD**, **12-Factor**, **OpenTelemetry**.
>
> Método: 9 dimensões mapeadas no código real → benchmark vs padrão world-class → síntese executiva → **revisão adversarial** que verificou as alegações P0 contra o código. **86 gaps brutos → ~30 workstreams.** As correções da revisão já estão incorporadas abaixo.
>
> Documento de **planejamento** — nenhuma mudança aplicada. Data: 2026-06-03.

---

## 0. Tese central (e onde ela falha)

A W3ADS **construiu mecanismos sofisticados e deixou quase todos sem enforcement, sem monetização, ou falhando aberto**. O trabalho mais barato e de maior alavancagem em sua maioria **não é construir** — é **ativar** o que já existe.

⚠️ **Ressalva crítica da revisão**: essa tese vale para ~4 dos 5 movimentos de maior impacto, **mas NÃO para o RLS**. As políticas RLS existem, porém foram escritas para o **caminho Supabase Data API** (`auth.uid()` + roles `authenticated/anon/service_role`). O app conecta via **Prisma sobre `DATABASE_URL`** e **nunca** seta `request.jwt.claims` por request → `auth.uid()` resolve NULL em toda query. Trocar para um role `NOBYPASSRLS` hoje **não ativa defesa nenhuma — trava o app fora dos próprios dados**. RLS é um **build real (L)**, não um "flip de env". Liderança precisa saber disso.

---

## 1. O que JÁ é world-class (crédito devido — não re-litigar)

- **Núcleo do sync orchestrator** — claim atômico CAS + slicing com deadline (budget 270s), `estimatedBatchMs` por provider, cooldown de 30min, cursores persistidos. Design distribuído maduro.
- **Disciplina de retry** — `callWithRetry` (backoff exponencial + jitter + retry-after) e o backoff de auth de 15min do iSET são textbook.
- **Escrita idempotente de métricas** — `dailyMetric.upsert` por `dedupeHash`; `ecommerceOrderItem` delete-by-`externalOrderId` + `createMany`. A parte difícil do exactly-once está resolvida.
- **Health probe** — `/api/health` já agrega Postgres / vault / Redis / Inngest / auth com semântica 200/503. Falta só token-gate + monitor externo.
- **Sentry server-side** — `tracesSampleRate=0.1`, `captureRequestError`, `sendDefaultPii=false`.
- **CSP** — nonce-based `script-src` com `strict-dynamic`, `frame-ancestors`/`object-src`/`base-uri` travados.
- **OAuth hardening em conectores de host fixo** — Shopify `*.myshopify.com`, Nuvemshop base fixa. Não vulnerável a SSRF.
- **Token vault** — criptografia com `keyVersion` já suporta rotação.
- **Cobertura de testes** — ~140 testes unit (oauth-state, token-vault, rate-limit, lgpd-export) + Playwright e2e. O *conteúdo* é bom; o problema são os *gates*.

---

## 2. Os 5 movimentos de maior alavancagem

Ranqueados por (impacto × alcance entre dimensões) ÷ esforço. **Liderar com os que são ativações genuínas; apresentar o RLS como o único build real.**

1. **CI virar real** — flip `npm test` → `npm run test:coverage` (ativa o gate dormente de 70%) + Postgres service container + branch protection no `main`. Três mudanças minúsculas que convertem um aparato de qualidade *consultivo* em *bloqueante*. Hoje `main` é pushável direto, o gate de cobertura nunca roda, e o CI testa contra um `localhost:5432` morto. _(CI/CD + Testing, S+S+M)_
2. **Cron de sync `0 6 * * *` → `*/30 * * * *` + `ORDER BY lastSyncedAt ASC` + cron de SLO/cobertura.** Hoje qualquer tenant além do batch cap de 50 workspaces **nunca sincroniza, sem alerta**. Corrige correção para tenants grandes E transforma dados de falha já persistidos (`SyncJob.status`, `lastSyncError`) em paging proativo. _(Reliability, S)_
3. **Sentry client** — `instrumentation-client.ts` + `setUser({id})`/`setTag('workspace_id')` + `release=VERCEL_GIT_COMMIT_SHA`. Erros de browser são invisíveis hoje (sem SDK client); erros server não têm dimensão de tenant. _(Observability, S)_
4. **Entitlements** — módulo `PLAN_LIMITS` + `assertWithinLimit()` ligado em criação de conector/seat. `WorkspacePlan` (FREE/PRO/AGENCY) é coluna morta lida em zero arquivos — o produto é ilimitado independente de plano. Pré-requisito de QUALQUER monetização, antes mesmo do Stripe. _(Billing, L)_
5. **RLS no DB (o único build real, não env flip)** — provisionar role app `NOBYPASSRLS`, **escrever a injeção de contexto de tenant por request** (Prisma Client Extension com `set_config` em transação) E **reconciliar os dois modelos de autoria** (`auth.uid()` vs `app.current_workspace`), com teste de integração cross-tenant junto. Até landar, isolamento depende 100% do `where:{ workspaceId }` na app. _(Data + Multi-tenancy, L, com risco de indisponibilidade)_

---

## 3. P0 — Bloqueante de produção

> A revisão concluiu: **o P0 de "2 semanas" não é alcançável** com escopo verificado. Split honesto abaixo. O produto demonstra sem isso, mas **não pode carregar dado real multi-tenant nem cobrar** com segurança.

### 3a. Semana 1 — "estancar o sangramento" (tudo S, independente, remove perda irreversível e falha silenciosa)

| # | Ação | Severidade | Esforço | Framework |
|---|------|-----------|---------|-----------|
| **P0-0** | **Deletar os 19 `migration 2.sql` dentro de diretórios Prisma rastreados** + `middleware 2.ts`, `instrumentation 2.ts`, `sentry.*.config 2.ts`, `global-error 2.tsx`, ~50 `* 2.ts(x)` test/script. Um `migration 2.sql` errante é **vetor de corrupção de dados em produção**. Adicionar CI guard rejeitando `' 2\.(ts\|tsx\|sql)$'`. **Bloqueia P0-CI** (senão glob amplo passa a rodar twins `* 2.test.ts` stale). | HIGH | S | Migration safety; determinismo |
| **P0-2** | **Rate-limit de `auth` falhar FECHADO** — em exceção do limiter retornar 503 (não `return null`, `rate-limit.ts:180-183`); tratar credenciais Upstash ausentes/placeholder como 503 duro em prod nas rotas de auth (cobrir o catch **e** o path placeholder, `:51`); limiter secundário por-email em forgot/reset. | CRITICAL | M | OWASP ASVS 2.2.1, A07:2021, SOC2 CC6.1 |
| **P0-6** | **Correção do cron de sync** — `0 6 * * *` → `*/30 * * * *` + `ORDER BY lastSyncedAt ASC` na query de stale + métrica de cobertura (workspaces > 2× threshold). | CRITICAL | S | AWS WA REL; SRE capacity |
| **P0-10** | **Sentry client** — `instrumentation-client.ts` (`Sentry.init` guardado por `isValidSentryDsn`, `onRouterTransitionStart`) + `setUser`/`setTag('workspace_id')` no path de auth + `release=VERCEL_GIT_COMMIT_SHA` em todos os inits; `SENTRY_AUTH_TOKEN/ORG/PROJECT` obrigatórios no build prod. | CRITICAL | S | Sentry frontend + Release Health |
| **P0-11** | **Connection pooling** — confirmar `DATABASE_URL`→pooler `?pgbouncer=true&connection_limit=1`, `DIRECT_URL`→5432; assertar correção em `scripts/validate-production-env.mjs` (falhar build em misconfig). | HIGH | S | AWS WA REL; Prisma serverless |
| **P0-BKP** | **PITR + drill de restore testado** _(puxado do P1)_ — "habilitado mas nunca testado" = **não é backup**. Único item cuja falha = **perda irrecuperável de receita do cliente** (7k+ pedidos/tenant). Drill = meio dia. Documentar RPO/RTO. | CRITICAL | M | AWS WA REL09 |
| **P0-CASCADE** | ✅ **VERIFICADO 2026-06-05: já seguro.** Não existe `connectorAccount.delete` no código; disconnect/revoke setam `status=REVOKED` (preserva pedidos/métricas). CASCADE só dispara em deleção de conta/workspace (intencional/LGPD). Soft-delete preventivo em orders/metrics rebaixado para P1-12. | — | — | Retenção/auditabilidade |

**Saída da Semana 1**: "seguro para 1 cliente amigo". Sem perda irreversível, sem falha silenciosa de sync, erros triáveis por tenant.

### 3b. Semanas 2-3 — "seguro para multi-tenant arms-length"

| # | Ação | Severidade | Esforço | Framework |
|---|------|-----------|---------|-----------|
| **P0-CI** | (a) `npm test`→`npm run test:coverage`; (b) service `postgres:16` + `prisma migrate deploy` antes de test/e2e; (c) `prisma migrate diff --exit-code` (drift); (d) `engines`+`.nvmrc` — **decidir 22 vs 24 deliberadamente** (CI hoje usa `node 22`, sem `engines`; Vercel default p/ Next recente é 22.x — **verificar antes de pinar**). | CRITICAL | M | DORA quality gate; paridade prod |
| **P0-9** | **Branch protection no `main`** — PR + 1 approval + check `verify` + linear history + bloquear force-push; `.github/CODEOWNERS` (api/auth/prisma-migrations) + PR template com checklist de migration destrutiva. Deploy via Vercel CLI = break-glass apenas. | CRITICAL | S | DORA CFR; SLSA L2 |
| **P0-12** | **Brand grid ilimitado** — reescrever `getRealBrands` (`dashboards/page.tsx:209-278`) de agregação JS-Map sobre *todos* os pedidos/métricas para Prisma `groupBy` (SUM por workspaceId/source) na janela; índices `(placedAt, workspaceId)` + `(date, workspaceId, source)`. **Cuidado**: migration `20260528160000` já adicionou índice de plataforma (não duplicar); `CREATE INDEX CONCURRENTLY` **fora** da transação da migration (migrations Prisma rodam em tx). Hoje dá OOM conforme marcas crescem. | CRITICAL | M | AWS WA Perf; query budgets |
| **P0-3** | **Integridade do audit trail** — adicionar AuditActions `platform.user.role_update`/`role_bootstrap`; parar de logar self-escalation de ADMIN_MASTER sob `connector.provider_config.update`; envolver bootstrap count-then-promote numa transação condicional (fecha TOCTOU). | HIGH→CRIT | S | OWASP A09; SOC2 CC6.1/CC7.2 |
| **P0-4** | **Auditar acesso cross-tenant de platform-admin** — emitir `admin.workspace.access` nos branches de membership sintética (`current.ts:239-292`): platformRole, workspaceId alvo, IP, UA; default sintético = VIEWER; write exige elevação logada. | HIGH | M | SOC2 CC6.1/6.3/7.2 |
| **P0-5** | **SSRF guard** — `assertPublicHttpUrl()` em `src/lib/security/ssrf.ts`, chamado em `normalizeIsetBaseUrl` + builders manual-commerce. Rejeitar IP literal / `.internal` / `.local` / `169.254.169.254`; pinar https/443. Testes p/ metadata-IP + range privado. | HIGH | M | OWASP A10 SSRF; ASVS 12.6 |

### 3c. Spike dedicado (~1 semana) — RLS

| # | Ação | Severidade | Esforço |
|---|------|-----------|---------|
| **P0-RLS** | **NÃO é flip de env.** (1) Provisionar role `w3ads_app NOBYPASSRLS LOGIN`; (2) **escrever** Prisma Client Extension que injeta contexto de tenant por request (`set_config('request.jwt.claims',...)` em tx) — sem isso `auth.uid()` é NULL; (3) **reconciliar** os dois modelos de autoria RLS (`auth.uid()` Supabase vs `app.current_workspace`); (4) `FORCE ROW LEVEL SECURITY`; (5) **teste de integração cross-tenant** (P1-10) landa JUNTO; (6) CI assert `rolbypassrls=false`. Risco real de lock-out — fazer isolado. | CRITICAL | L |

**Controle compensatório enquanto RLS não landa**: lint/teste que faz grep de toda query Prisma em rotas tenant exigindo filtro `workspaceId` + CODEOWNERS na camada de dados.

---

## 4. P1 — Hardening (~1 trimestre)

Fecha o gap de "seguro para lançar" → "defensável sob auditoria SOC2/LGPD e durável sob carga". Inclui a **espinha comercial**.

### Reliability & durabilidade
| # | Ação | Sev / Esforço |
|---|------|---------------|
| P1-1 | **Inngest `onFailure` (DLQ)** nas fns de backfill → persistir payload falho em `SyncJob` (FAILED + range), tag Sentry `dlq`; replay cron limitado. ⚠️ **Revisão: não há fns Inngest definidas em `src/` hoje** (só env + health check) → P1-1/2/3 são **greenfield (L/XL), não hardening**. Confirmar ou re-escopar. | HIGH / L |
| P1-2 | **Idempotência em `SyncJob.create()`** — run-key `${connectorAccountId}:${since}:${until}:${syncType}` dentro de `step.run`; header de idempotência em mutações externas iSET. | HIGH / M |
| P1-3 | **Rotear backfill via Inngest** (`buildConnectorBackfillEvent`), só foreground inline; gate `isInngestConfigured()` com fallback. Remove a cauda de 3 anos do iSET (hoje estoura 300s síncrono). | HIGH / L |
| P1-4 | **Circuit breaker por (connector,provider)** em `ConnectorAccount.metadata` — K falhas → `breakerOpenUntil`, probe half-open; checado no topo do loop do orchestrator. | MED / M |
| P1-5 | **Logger estruturado (Pino)** JSON `{runId, workspaceId, provider, phase, durationMs}`; threade o `claimId` como `runId`; reusar `redactSensitiveValues` como redactor; substituir 26 `console.*`. | HIGH / M |
| P1-6 | **Correlation ID** no `middleware.ts` (`x-request-id`) → tag Sentry + audit metadata. | HIGH / M |

### Multi-tenancy, compliance & data
| # | Ação | Sev / Esforço |
|---|------|---------------|
| P1-7 | **Cron de purge de conta** `/api/cron/account-purge` — hard-delete de users com `deletedAt` > 30d + dados de OWNER único; **anonimizar** AuditLog (manter trilha, tirar PII). Hoje a UI diz "marcada para purge" e **não purga** → fecha direito de exclusão LGPD. | HIGH / M |
| P1-8 | **Completar export LGPD** — `buildUserDataExport` incluir metadata de conector (sem tokens), dashboards, AuditLog do próprio user; teste por categoria. | HIGH / M |
| P1-9 | **AuditLog imutável + retenção** — sob role NOBYPASSRLS, policy INSERT-only, negar UPDATE/DELETE; retenção 12-24mo. _(Gatilho: puxar só quando auditoria SOC2 real chegar.)_ | MED / M |
| P1-10 | **Teste integração RLS cross-tenant** (testcontainers/Supabase branch) — 2 tenants, A não lê B (orders/metrics/connectors/audit) na API **e** no DB. **Landa com P0-RLS.** | MED / M |
| P1-11 | **Revogação de sessão** em reset/troca de senha (`session.deleteMany`) + "sair de todos"; TOTP 2FA p/ platform-admin. _(2FA: pode esperar gatilho.)_ | MED / L |
| P1-12 | **Soft-delete em tabelas transacionais** — `deletedAt?` em EcommerceOrder/Item + DailyMetric; disconnect/archive seta em vez de CASCADE destruir; correções de métrica via append+`supersededAt`; filtrar `deletedAt:null`. _(Parte foi puxada p/ P0-CASCADE.)_ | HIGH / M |
| P1-14 | **Observabilidade Prisma** — `log` events warn/error + slow-query (>300ms)→Sentry; `pool_timeout`/`connect_timeout` explícitos; `@@index([connectorAccountId, date])` via `CREATE INDEX CONCURRENTLY`. | HIGH / S |

### Segurança, observability & delivery
| # | Ação | Sev / Esforço |
|---|------|---------------|
| P1-15 | **Supply-chain CI** — `dependabot.yml` (npm+actions), CodeQL (js-ts), gitleaks step + pre-commit. **+ scan do histórico git** (não só dali pra frente) e **rotacionar `TOKEN_ENCRYPTION_KEY`/`AUTH_SECRET` se já commitados** (há padrão de incidente "commit secret" documentado). | HIGH / M |
| P1-16 | **Audit `authz.denied`** em todo 403/forbidden; centralizar wrappando checks; denials de alta frequência → Sentry. | MED / M |
| P1-17 | **Token-gate `/api/health`** (público = ok/not-ok; breakdown só com `HEALTH_CHECK_TOKEN`) + **monitor de uptime externo** (UptimeRobot/Better Stack) no canal de paging. | MED / S |
| P1-18 | **Alerting atado a SLO + on-call** — regras Sentry + Slack/PagerDuty; `beforeSend` scrub PII. | HIGH / M |
| P1-19 | **Preview deploy por PR** + **smoke pós-deploy** (`deployment_status` → curl `/api/health` + Playwright subset vs URL do deploy); validação de env no target `preview`. | HIGH / M |
| P1-20 | **Delivery com rollback seguro** — SOP `vercel rollback` + Rolling Releases; **migrations expand/contract** (adotar a regra desde o P0) para que reverter deploy seja sempre DB-safe. | CRIT / M |
| P1-21 | **`docs/RUNBOOK.md` + INCIDENT_PLAYBOOK** — modos de falha → sinais reais (`lastSyncError`, `SyncJob FAILED`, `/api/health`, cron `candidates:0`); RTO/RPO; cadência de rotação de secrets (via `keyVersion`); notificação LGPD/ANPD (72h); **lista de subprocessadores** (Supabase/Vercel/Upstash/Resend/Sentry/Google/Meta/Shopify/Nuvemshop) na página de privacidade. | MED / S-M |
| P1-22 | **security.txt (RFC 9116) + SECURITY.md** + apertar CSP (dropar `style-src-attr 'unsafe-inline'` se Radix/Tailwind permitir; escopar `img-src`; Sentry `report-to`). | LOW / S |

### Espinha comercial
| # | Ação | Sev / Esforço |
|---|------|---------------|
| P1-23 | **Módulo entitlements** `src/lib/billing/entitlements.ts` — `PLAN_LIMITS{maxConnectors/Seats/Dashboards/retentionDays}` + `assertWithinLimit()` ligado ANTES do upsert de conector (`meta-system-user-action.ts:72`) e de `createWorkspaceInvite`. Faz a coluna morta `WorkspacePlan` virar real **sem Stripe**. | CRIT / L |
| P1-24 | **Dedup/auto-join de workspace** — antes do fallback `workspace.create` em `service.ts`, checar domínio de email p/ workspace existente → join ou prompt; guard de idempotência no path de invite falho; util admin de merge + audit `workspace.merge`. Para a dívida de workspaces órfãos **agora** (causou os duplicados "Fran Adesivos"/"Franadesivos"). | HIGH / M |
| P1-25 | **Feature flags PostHog** `isFeatureEnabled(key, workspaceId)` — dark-launch de conectores, gating de plano/beta, **kill switch** de sync sem redeploy. Pareia com rollback ("desliga primeiro, reverte depois"). | HIGH / M |

---

## 5. P2 — Escala & maturidade (6mo+)

| # | Ação | Dimensão | Sev / Esforço |
|---|------|----------|---------------|
| P2-1 | **Stripe Billing completo** — campos billing no Workspace, webhook signature-verified, Customer no `registerUserWithWorkspace`, Customer Portal. _(Revisão: avaliar se beta precisa de Stripe self-serve ou se invoice manual + entitlements cobre 6 meses. Não over-build XL sem cliente pagante.)_ | Billing | CRIT / XL |
| P2-2 | **Seleção de plano self-serve + página de billing** com uso vs limites + Checkout. | Billing | HIGH / L |
| P2-3 | **Lifecycle de pagamento/dunning** — webhook → `past_due`→grace→degrade FREE; emails Resend; `trialStartedAt/EndsAt`. | Billing | HIGH / L |
| P2-4 | **Telemetria de growth** — `AnalyticsEvent` com `trial_start/checkout_started/plan_upgraded/payment_failed/limit_reached`. _(Stub de tipo = quick win agora.)_ | Billing | MED / S |
| P2-5 | **Particionamento time-series + retenção** — range mensal em `DailyMetric.date`/`EcommerceOrder.placedAt` (expand-contract) antes de ~10-50M linhas. _(Gatilho por volume.)_ | Data | MED / L |
| P2-6 | **Read replica** p/ agregação de dashboard, quando P1-14 mostrar contenção read/write. | Data+Perf | LOW / M |
| P2-7 | **Cache + streaming** — `unstable_cache` em `getDashboardSnapshot`/`getRealBrands` (key `(workspaceId,period)`, `revalidate:300`, tag `workspace:{id}:metrics`), invalidar via `revalidateTag` no write; `<Suspense>` p/ KPIs streamarem antes das 4 tabelas pesadas (LCP). | Performance | HIGH / L |
| P2-8 | **RUM / Web Vitals** — `useReportWebVitals`/`@vercel/speed-insights` → PostHog; Sentry `browserTracingIntegration` (depende de P0-10). | Obs+Perf | MED / S |
| P2-9 | **Bundle budgets + code-split charts** — `@next/bundle-analyzer` + gate de tamanho no CI; `next/dynamic(ssr:false)` p/ recharts (hoje no bundle inicial de 364.5K). | Performance | MED / M |
| P2-10 | **DORA Four Keys instrumentado** — deploy markers Vercel → releases Sentry/PostHog; Action lendo Deployments API + timestamps de merge. | CI/CD | MED / M |
| P2-11 | **Contract tests (MSW)** Meta/Google/Shopify/Nuvemshop + schema-snapshot nas rotas de receita; **mutation testing (Stryker)** noturno na matemática de sync/metrics; **integration tests** dos 23 `route.ts` (HMAC, CRON_SECRET, OAuth state). | Testing | HIGH / L |
| P2-12 | **a11y (axe-playwright) + coverage upload (Codecov) + flake reporting + config de pool vitest** (`pool:'forks'`, forks limitados p/ runner 2-core, `testTimeout:10000`). | Testing | MED-LOW / S-M |
| P2-13 | **IaC** — bootstrap Supabase idempotente + CI-runnable; Supabase CLI declarativo; longo prazo Terraform p/ Vercel + Supabase (DR/staging = `terraform apply`). | CI/CD | MED / L |
| P2-14 | **Consent granular de cookies** (quando Sentry replay/analytics forem live) + registro server-side; changelog in-app. | Multi+Billing | LOW / S-M |

---

## 6. Gaps adicionais levantados pela revisão (não cobertos no rascunho)

1. **FinOps / guardrails de custo** — stack serverless + Supabase + Upstash + Sentry com `findMany` ilimitado (P0-12) e crons fan-out por workspace = risco de conta disparada. Adicionar: alertas de spend Vercel/Supabase, cap de volume de evento Sentry, budget Upstash. Barato; constrangedor de omitir.
2. **Teste de capacidade/carga ausente** — SLOs definidos mas zero load/soak test. k6 no dashboard + run sintético de 100 workspaces **antes** de comprometer 99.5% de disponibilidade publicamente.
3. **`next-auth@5.0.0-beta.25`** — auth de produção numa dependência **beta** é risco HIGH próprio, não parêntese. Plano de pin quando estável.
4. **SBOM (CycloneDX)** — gerar no CI; falta no P1-15.
5. **Residência de dados** — `vercel.json` pina `gru1` (SP, bom p/ LGPD), mas região Supabase/Resend não verificada. Atestado de 1 linha "todos processam/replicam em regiões aceitáveis".
6. **Acessibilidade (WCAG) sales-gated** — ok deferir p/ P2 num beta, **mas qualquer procurement enterprise (pedido de VPAT) trava o deal**. É dependência gated por venda, não só maturidade.
7. **Vendor lock-in / exit posture** — acoplamento forte a Supabase (RLS é Supabase-Data-API-shaped), Vercel crons, Upstash, Inngest. Um parágrafo "mapa de lock-in + custo de saída" no doc de liderança.

---

## 7. SLO / SLI (sobre dados já persistidos — zero infra nova)

| SLI | Definição | SLO | Error budget | Alerta de burn |
|-----|-----------|-----|--------------|----------------|
| **Connector freshness** | % `ConnectorAccount` ACTIVE com `lastSyncedAt` < 26h | **99%** | 1% / 30d | Page se ≥2% stale ou fast-burn >5%/1h |
| **Sync success rate** | `SyncJob` SUCCESS ÷ (SUCCESS+FAILED), 24h | **98%** | 2% / 24h | Page se >5% FAILED/provider/1h |
| **Sync backlog coverage** | workspaces com `lastSyncedAt` > 2× threshold | **0** sustentado | — | Page se >0 por 2 ciclos de cron |
| **API availability** | non-5xx ÷ total, 28d | **99.5%** | 0.5% / 28d | Multi-window burn (1h+6h) |
| **`/api/health` uptime** | monitor externo | **99.9%** | — | Page em 2 falhas consecutivas |
| **Dashboard LCP (p75)** | RUM, rota dashboard | **< 2.5s** | — | Alerta p75 > 2.5s/24h |
| **Dashboard INP (p75)** | RUM | **< 200ms** | — | Alerta p75 > 200ms/24h |
| **DSAR turnaround** | export + erasure | **export < 24h, erasure ≤ 30d** | — | Alerta em purge overdue |

> Não comprometer 99.5% de disponibilidade publicamente até validar com load test (§6.2).

## 8. DORA — metas

| Métrica | Atual | 90 dias | 6 meses |
|---------|-------|---------|---------|
| **Deployment frequency** | não medido (direct-to-main ad-hoc) | medido + ≥ diário on-demand | múltiplos/dia (elite) |
| **Lead time** | não medido | < 1 dia commit→prod | < 1h (elite) |
| **Change failure rate** | não medido, estruturalmente alto | < 15% | < 5% (elite) |
| **MTTR** | ~ilimitado (sem rollback SOP, migrations forward-only) | < 1h (rollback + smoke) | < 1h c/ auto-halt rolling (elite) |

---

## 9. Sequenciamento (dependências)

- **P0-0 (shadow files) ANTES de P0-CI** — senão glob amplo roda twins `* 2.test.ts` stale.
- **P0-RLS gateia P1-9 (audit imutável) e P1-10 (teste cross-tenant DB)** — policies só vinculam quando o app não conecta como superuser.
- **P0-10 (Sentry client) gateia P2-8 (Web Vitals Sentry)** e qualidade do alerting P1-18.
- **P1-23 (entitlements) gateia P2-1..P2-4 (Stripe)** — shipar limites FREE antes de ter o que vender, p/ os estados "limit-reached" (e CTAs) já existirem quando o Checkout chegar.
- **Expand/contract migration (P1-20) governa TODA migration desde o P0.**
- **PITR drill (P0-BKP) + soft-delete-on-disconnect (P0-CASCADE) na Semana 1** — pareados são landmine de perda irreversível.

---

### Apêndice — cobertura da auditoria

86 gaps mapeados em 9 dimensões: Reliability & SRE (11), Observability (9), Application Security (8), Multi-tenancy & Compliance (9), Data & Database (9), Testing & Quality Gates (11), CI/CD & Delivery (11), Performance & Scalability (9), Product/Billing/Growth (9). Workflow: 20 agentes, ~1.4M tokens, verificação adversarial contra código real.
