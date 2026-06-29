# Plano de Remediação — Production Readiness (W3ADS)

> Gerado por workflow multi-agente (18 agentes verify+design) contra o código atual.
> Todos os 9 achados do code-review foram **confirmados** na árvore atual.
> Data: 2026-06-22 · Branch: `feat/connectors-expanded`

## Status de execução (2026-06-22)

**Onda 1 implementada (itens 1–11).** Validação: `npm audit --audit-level=high` 0 high · `npx vitest run` 177/177 · `npx tsc --noEmit` 0 erros · `npm run lint` 0 erros (1 warning pré-existente). Build em verificação.

| # | Item | Status |
|---|---|---|
| 1 | npm audit 4 high → 0 | ✅ `audit fix` + override undici |
| 2 | Testes só-teste (4,5,6,7) | ✅ |
| 3 | ADMIN priv-esc (settings OWNER-only) | ✅ |
| 4 | Validação OAuth bypass | ✅ env-default não satisfaz ativação |
| 5 | GMV inflado (fulfillment ≠ pago) | ✅ + items contam sem status |
| 6 | Account takeover senha | ✅ reset só p/ membro USER + revoga sessões |
| 7 | Connector hard-delete → REVOKED | ✅ preserva orders/metrics |
| 8 | SSRF guard | ✅ `url-guard.ts` nos 2 boundaries |
| 9 | Health token-gate | ✅ público só `{ok}` |
| 10 | Bootstrap audit label | ✅ `platform.admin.bootstrap` |
| 11 | Cron severeBacklog → Sentry | ✅ + scheduler externo = passo ops |
| 12 | RLS efetivo | ⏸️ adiado (decisão: pós-Onda 1) |

**Para `/codex:adversarial-review` (money/auth path):**
- order-status: collision `"efetuado"` (WBuy=pago vs LI=placed) — mantido em APPROVED; confirmar ingestion WBuy/LI.
- deltaPercent: cap ±999 para baseline 0 (decisão de UX, atualizei teste 100→999).
- members/actions: boundary de reset de senha (gatilho auth).

---

## Veredito

**Não passa para produção ainda.** 4 P0 + 2 bugs CRÍTICOS escondidos no gate de testes (inflação de GMV e privilege escalation de ADMIN) bloqueiam dado real multi-tenant / cliente pagante.

Descoberta importante do gate de testes: 2 dos 15 testes falhos não são "teste desatualizado" — são **bugs de segurança/financeiro reais** (clusters 1 e 2 abaixo). Tratar como P0 efetivos.

---

## Ordem de ataque recomendada

Sequência por (blast radius × isolamento × esforço). Cada bloco é PR atômico.

| Ordem | Item | Sev | Esforço | Risco fix | Migration? |
|---|---|---|---|---|---|
| 1 | Gate npm audit (4 high) | GATE | S | low | não |
| 2 | Testes — clusters só-teste (4,5,6,7) | GATE | S | nenhum | não |
| 3 | Testes — cluster 2 (ADMIN priv-esc) | P0* | S | low | não |
| 4 | Testes — cluster 3 (validação OAuth bypass) | P0* | S | med | não |
| 5 | Testes — cluster 1 (GMV inflado) | P0* | M | med | não |
| 6 | Password takeover (account takeover) | P0 | M | low | não |
| 7 | Connector hard-delete → REVOKED | P0 | M | med | não |
| 8 | SSRF guard conectores manuais | P0 | M | med | não |
| 9 | Health endpoint token-gate | P1 | S | low | não |
| 10 | Bootstrap audit action label | P1 | S | low | não |
| 11 | Cron sync → scheduler externo 30min | P1 | S | low | não |
| 12 | **RLS efetivo (role NOBYPASSRLS + contexto)** | P0 | **XL** | **high** | **sim** |

> Itens 1–11 são small/medium, isolados, sem migration → podem fechar rápido e destravar o gate.
> Item 12 (RLS) é o único XL/migration/alto-risco — é um **spike**, não um env-flip. Decisão explícita necessária (ver seção RLS).

---

## P0 — Bloqueadores

### 6. Account takeover via reset de senha cross-workspace
**Arquivo:** `src/app/(app)/workspace/members/actions.ts` (lookup ~89, update senha ~114)
**Estado:** ADMIN/OWNER de QUALQUER workspace reseta `passwordHash` de QUALQUER usuário por email — `findUnique({email})` é global, sem checar membership. Inclui admins internos de plataforma.
**Fix:** 3 ramos explícitos na `$transaction`:
- usuário **não existe** → cria com senha (atual).
- existe **E já é membro do workspace atual** → reset permitido (escopo correto).
- existe mas **não é membro** → nunca tocar `passwordHash`/`name`; só `membership.upsert`. Flash com `password:null`.

Auditoria honesta: split em `workspace.member.create` / `.reset` / `.add`. Sem 2FA (YAGNI — membership já fecha o boundary).
**Verificação:** unit (caso c: `txUserUpdate` NÃO chamado) + `npm test` + check manual no banco que hash da vítima não muda. → `/codex:adversarial-review` antes do merge (gatilho auth).

### 7. Remover conector apaga dados de produção em cascata
**Arquivo:** `src/app/api/connectors/[id]/route.ts:80` · FKs CASCADE em `schema.prisma:272,307,334,428`
**Estado:** hard delete da `ConnectorAccount` cascateia e apaga `DailyMetric`, `EcommerceOrder`, `EcommerceOrderItem`, `SyncJob`. Irreversível.
**Fix:** trocar `delete` por `update({ status: REVOKED })`. Enum `ConnectorStatus.REVOKED` **já existe** (`schema.prisma:263`) — sem migration. Sync-orchestrator já filtra `status: ACTIVE`, então REVOKED some do cron. Reconnect usa upsert no unique → reativa a MESMA linha, preserva histórico. Zerar secret ids (vault cleanup mantém-se). Filtrar REVOKED no listing (`page.tsx`). NÃO mexer nas FKs (cascade correto p/ delete de workspace de verdade).
**Verificação:** unit (assert `update REVOKED`, nunca `delete`) + teste de reconnect preserva child rows + check `count(EcommerceOrder)` inalterado.

### 8. SSRF em conectores manuais
**Arquivos:** `connectors/settings/actions.ts:81` (save) · `manual-commerce-client.ts:57` (`normalizeBaseUrl`) · `provider-config.ts:351-399` (validação)
**Estado:** `baseUrl` arbitrário salvo e usado em `fetch` sem guard. Aceita `localhost`, `127.0.0.1`, `169.254.169.254` (metadata AWS/GCP), RFC1918, `.internal`.
**Fix:** novo `src/lib/connectors/url-guard.ts` com `assertPublicHttpUrl(raw)`: rejeita protocolo não-http(s), `localhost`/`.internal`/`.local`, IP literal em ranges privados/reservados (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `0/8`, IPv6 `::1`/`fc00::/7`/`fe80::/10`/`::ffff:` mapped). Sem dep nova (comparação numérica de octetos). Plugar em **2 boundaries** (defense-in-depth): validação no save **E** runtime no `normalizeBaseUrl` (cobre configs já salvas + GOOGLE_SHEETS que bypassa normalize). DNS-rebinding fica fora de escopo (documentar — exige Agent com lookup pinado, é XL, não é o achado).
**Verificação:** TDD — `url-guard.test.ts` RED primeiro, depois plugar. Cuidado regressão: confirmar que nenhum tenant usa IP público em CGNAT 100.64/10 antes de incluir essa range.

### 12. RLS não é efetivo (decisão arquitetural)
**Arquivos:** `src/lib/db/prisma.ts` (sem injeção) · migrations `20260516221000`, `20260522170000` (policies em `auth.uid()`)
**Estado:** Prisma conecta como superuser (BYPASSRLS). Policies gateiam em `auth.uid()`/JWT do Supabase que o Prisma nunca terá. **Isolamento hoje = 100% filtros `workspaceId` no código.** É limitação de design conhecida (memory `w3ads-rls-needs-prisma-context-injection`), não bug.
**Fix (spike XL):**
1. Migration: role `w3ads_app NOBYPASSRLS LOGIN` + grants.
2. Reescrever policies: `auth.uid()` → função `w3ads.current_app_user_id()` = `coalesce(nullif(current_setting('app.user_id',true),''), auth.uid()::text)` (serve JWT **e** Prisma).
3. `ENABLE` + `FORCE ROW LEVEL SECURITY` nas tabelas de dados hoje sem policy (`DailyMetric`, `EcommerceOrder`, `EcommerceOrderItem`, `AuditLog`).
4. 2 conexões Prisma: `prisma` (superuser, p/ cron/sync sem request) + `prismaRls` (`DATABASE_URL_APP`). Helper `withRlsContext(userId, fn)` com `set_config('app.user_id', …, true)` **LOCAL** dentro de `$transaction` — obrigatório por causa do pgbouncer transaction mode (porta 6543), senão vaza entre tenants.
5. Wiring incremental rota-a-rota (PRs separados, sem big-bang). Manter `WHERE workspaceId` como defesa-em-profundidade durante toda transição.

**Ponto de falha de prod:** provisionar password da role e setar `DATABASE_URL_APP` em Railway/Vercel **ANTES** do deploy do código (memory: repoint sem injeção trava prod).
**Verificação:** teste DB-level — `withRlsContext(userA)` faz SELECT em workspace do userB **sem** `WHERE workspaceId` → 0 rows (prova RLS ativo). Mesma query com `prisma` superuser → retorna (cron intacto). Prova pgbouncer: `current_setting` vazio fora da transação.

> **Decisão necessária:** este item é XL/alto-risco/migration. Alternativa de curto prazo: declarar explicitamente o **controle compensatório** (filtros `workspaceId` + lint/test enforcement) como aceito para o go-live, e agendar o spike RLS como fast-follow. Ver pergunta no fim.

---

## GATE — Testes (15 falhos / 9 arquivos)

6 clusters. **2 são bugs reais (P0 efetivos), 4 são testes desatualizados.**

| Cluster | Tipo | Arquivo | Impacto |
|---|---|---|---|
| 1. `"em separacao"` conta como pago | **BUG código** | `order-status.ts:20-28` + `manual-commerce.ts:102-114` | **Infla GMV/receita/ROAS** — termos de fulfillment no `APPROVED_TERMS` |
| 2. ADMIN tem `manage_workspace_settings` | **BUG código** | `permissions.ts:37-44` | **Privilege escalation** — deveria ser OWNER-only |
| 3. Validação aceita OAuth incompleto | **BUG código** | `provider-config.ts:250-257` | env defaults satisfazem validação de ativação → sync silenciosamente falha |
| 4. WBuy método GET | teste errado | `documented-commerce-clients.test.ts:51,82,109` | código certo (POST→400), teste espera POST |
| 5. Nuvemshop retorna objeto | teste errado | `nuvemshop-oauth.test.ts:93` | `{orders,complete,nextPage}`, teste espera array |
| 6. Registry tem 11 providers | teste errado | `connector-registry.test.ts:14,40` | LOJA_INTEGRADA adicionada (11º) |
| 7. Sentry/PostHog opcionais | teste errado | `production-env.test.ts:46` | já `optional:true` no script |

**Cluster 1 (cuidado — data-loss inverso):** não basta deletar `"separacao"`. Remover bloco de fulfillment do `APPROVED_TERMS` E remapear códigos pós-pagamento de Loja Integrada (11/13 → `pago`) para pedidos pagos não sumirem. Termo `"efetuado"` é ambíguo cross-platform (WBuy=pago, LI=placed-not-paid) — mapear no ingestion WBuy explicitamente. → `/codex:adversarial-review` (lógica de receita).

**Ordem:** clusters 4/5/6/7 primeiro (zero risco, destrava gate), depois 2 e 3 (1 arquivo cada), por último 1 (3 arquivos, maior blast radius).

---

## GATE — npm audit (4 high)

**Todos transitivos/dev, patches dentro dos ranges caret atuais.** `npm audit fix` (SEM `--force`) resolve os 4:
- `vite` 8.0.13→8.0.16 (dev) · `undici` 7.25→7.28 (dev via jsdom) · `@grpc/grpc-js` 1.14.3→1.14.4 (inngest) · `protobufjs` 7.5.8→7.6.4.

Endurecer: adicionar `"undici": ">=7.28.0"` ao bloco `overrides` existente. **Não** usar `--force` (quebra toolchain via major). Risco prod real ~nulo hoje (sem `OTEL_*` setado → exporters gRPC inativos), mas patch é trivial.
**Validação:** `npm audit --audit-level=high` → 0 high. Rodar em **Node 20** (memory: Node 24 quebra toolchain).

---

## P1 — Hardening (não bloqueia, fazer no mesmo ciclo)

**9. Health endpoint** (`api/health/route.ts`): segregar resposta. Público → `{ok, service, timestamp}`. Com `Bearer HEALTH_CHECK_TOKEN` → checks detalhados. `timingSafeEqual`. Default sem token = público boolean-only (degradação segura, mantém UptimeRobot). Esforço S.

**10. Bootstrap audit label** (`platform/bootstrap/actions.ts:32` + `audit/log.ts`): trocar `connector.provider_config.update` por novo `platform.admin.bootstrap` no union `AuditAction`. `action` é String livre no DB → sem migration. Esforço S.

**11. Cron sync** (`vercel.json:8` diário): causa-raiz não é código (route já idempotente, prioriza stale, instrumenta backlog) — é frequência (limite Hobby). Operacionalizar scheduler externo 30min batendo no mesmo endpoint (já documentado em `manual-setup.md`). Manter slot diário como fallback. Promover `severeBacklog` a `console.error` (Sentry). Esforço S.

---

## Melhorias de processo (o pedido original)

Para o próximo ciclo não chegar com 4 P0 + 2 bugs no gate:

1. **CI gate obrigatório no PR:** `npm audit --audit-level=high`, `npm test`, `npx tsc --noEmit`, `npm run build` — branch protection na `main`. Hoje 15 testes falhos e 4 high passaram despercebidos. (Já consta como pendência P0 manual no CLAUDE.md item 5.)
2. **Lint rule custom para `workspaceId`:** enquanto RLS não é efetivo, o controle compensatório precisa ser **enforçado por máquina**, não por convenção. Regra que falha se query Prisma multi-tenant não tem filtro `workspaceId`.
3. **Teste de isolamento cross-tenant no CI:** mesmo antes do RLS, um teste que cria 2 workspaces e tenta vazar dados de um pelo outro pega regressões de permissão (clusters 1/2 teriam sido pegos).
4. **SSRF/URL guard como utilitário compartilhado:** qualquer fetch para URL controlada por usuário passa por `assertPublicHttpUrl`. Documentar no padrão de conectores.
5. **Auditoria semântica:** cada ação sensível (auth, elevação, credencial) tem `AuditAction` dedicada — não reusar label de outro domínio.
6. **Review cross-provider em auth/RLS/billing:** `/codex:adversarial-review` como gate fixo para PRs que tocam esses domínios (já no CLAUDE.md, formalizar como required check).

---

## Sequenciamento sugerido (2 ondas)

**Onda 1 — Go-live blockers (1–2 dias, tudo S/M, sem migration):**
itens 1→11. Fecha gates (audit+testes), mata account-takeover, SSRF, cascade-delete, GMV inflado, priv-esc. Cada um PR isolado, `/codex:adversarial-review` nos de auth/receita.

**Onda 2 — RLS efetivo (spike dedicado):**
item 12. Migration + role + 2 conexões + wiring incremental. Coordenar com pendência P0-manual já listada (`liveshop_app NOBYPASSRLS`). Provisionar env ANTES do deploy.
