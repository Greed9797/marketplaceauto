# W3ADS — Setup manual (SQL + passo-a-passo)

> O que **você** aplica direto. O que é código fica comigo (PRs). Atualizado 2026-06-05.

---

## ⚠️ Leia antes

- **BANCO CENTRAL COMPARTILHADO** — o Supabase `tuzoczzohirqddrcpbtc` hospeda 3 apps (W3saas, Pulmão, W3ads). O W3ads vive **só no schema `w3ads`**. Toda operação de DB qualifica `w3ads."Tabela"`; nunca tocar role `postgres`, schemas `public`/`auth` ou dos outros apps; nunca `prisma migrate reset`/`dev` contra prod. Verificado: o Prisma do W3ads usa `?schema=w3ads`, migrations são w3ads-scoped → outros projetos intocados.
- **Índices de pedidos/métricas NÃO precisam de SQL** — `EcommerceOrder` e `DailyMetric` já têm os índices `(workspaceId, …)`. O brand grid lento é agregação em JS (corrijo no código, P0-12), não índice faltando.
- **RLS não está aqui de propósito.** As policies foram escritas pro Supabase Data API (`auth.uid()`), e o app conecta via Prisma sem setar esse contexto. Rodar `CREATE ROLE NOBYPASSRLS` + repoint **agora trava o prod**. RLS é o spike isolado — te entrego o script vetado quando o código de injeção de contexto estiver pronto, idealmente numa **branch de teste** do Supabase.

---

## 1. SQL — Diagnóstico (rode primeiro, é só leitura)

Cole no **Supabase → SQL Editor**. Confirma o estado atual sem mudar nada.

```sql
-- (a) O app conecta como superuser que ignora RLS? (esperado hoje: rolbypassrls = true → problema)
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres', 'w3ads_app');

-- (b) RLS está habilitado nas tabelas de tenant?
SELECT relname AS tabela, relrowsecurity AS rls_on, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'w3ads'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- (c) Quantas policies existem por tabela?
SELECT schemaname, tablename, COUNT(*) AS policies
FROM pg_policies
WHERE schemaname = 'w3ads'
GROUP BY 1, 2
ORDER BY 2;

-- (d) Índices atuais de ConnectorAccount (pra confirmar que o de baixo não duplica)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'w3ads' AND tablename = 'ConnectorAccount';
```

---

## 2. SQL — Índice do cron de sync (seguro aplicar agora)

Acelera a query de "conectores stale" (P0-6/P0-7: `WHERE status='ACTIVE' AND lastSyncedAt < cutoff ORDER BY lastSyncedAt`). Zero dependência de código.

> **Importante**: rode esta linha **sozinha** (sem outras no mesmo run). `CONCURRENTLY` não pode rodar dentro de transação — o SQL Editor do Supabase executa statement único fora de tx, então ok isolado.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ConnectorAccount_status_lastSyncedAt_idx"
  ON w3ads."ConnectorAccount" ("status", "lastSyncedAt");
```

Verificar depois:

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'w3ads' AND indexname = 'ConnectorAccount_status_lastSyncedAt_idx';
```

> Se este índice virar parte do schema Prisma depois, eu adiciono `@@index([status, lastSyncedAt])` no `schema.prisma` e marco a migration como já-aplicada — sem reaplicar. Me avisa quando rodar.

---

## 3. Passo-a-passo — PITR + drill de restore (não é SQL)

PITR é o único item cuja falha = perda irrecuperável de dados. "Habilitado" sem testar restore **não conta**.

### 3a. Habilitar PITR
1. Supabase → seu projeto → **Settings → Add-ons** (ou **Database → Backups**).
2. Habilitar **Point-in-Time Recovery** (exige plano Pro + add-on; ~US$100/mês). Define retenção (7 dias é o mínimo padrão).
3. Anotar no runbook: **RPO** (quanto de dado pode perder, com PITR ≈ 2min) e **RTO** (quanto tempo pra restaurar).

### 3b. Drill de restore (prova que funciona — faça mesmo sem PITR)
Não restaure por cima do prod. Teste com dump lógico num banco descartável:
1. Local, com o `DATABASE_URL` de prod no `.env`:
   ```bash
   pg_dump "$DATABASE_URL" --schema=w3ads --no-owner --no-privileges -Fc -f /tmp/w3ads_backup.dump
   ```
2. Criar um projeto/branch Supabase **descartável** (ou Postgres local), pegar a connection string dele como `$SCRATCH_URL`.
3. Restaurar:
   ```bash
   pg_restore --no-owner --no-privileges -d "$SCRATCH_URL" /tmp/w3ads_backup.dump
   ```
4. Validar contagem (deve bater com prod):
   ```bash
   psql "$SCRATCH_URL" -c "SELECT count(*) FROM w3ads.\"EcommerceOrder\";"
   ```
5. Apagar o scratch. Documentar: deu certo? quanto tempo levou? = seu RTO real.

---

## 3b. Frequência do cron de sync (free-tier → scheduler externo)

O cron `vercel.json` está em `0 6 * * *` (1×/dia) porque o projeto está em **plano free/Hobby** (limite: cron diário). O código já foi corrigido (P0-6: ordena mais-stale primeiro + reporta `backlog`/`severeBacklog`), mas pra rodar a cada 30min sem upgrade:

**Opção A — scheduler externo grátis** (cron-job.org / Better Stack):
1. Criar job HTTP **GET** para `https://w3-ads.vercel.app/api/cron/workspace-sync`
2. Header: `Authorization: Bearer <CRON_SECRET>` (mesmo valor da env no Vercel)
3. Schedule: a cada 30min
4. A resposta traz `{ candidates, backlog, severeBacklog }` — se `backlog > 0` por vários ciclos, aí sim considerar Pro.

**Opção B — upgrade Vercel Pro** (US$20/mês) → aí `*/30 * * * *` no `vercel.json` é aceito.

---

## 4. Passo-a-passo — Branch protection no GitHub (não é SQL)

Hoje o `main` é pushável direto (deploys via CLI furam review). Trava isso:

1. GitHub → repo `w3saas`/`w3ads` → **Settings → Branches → Add branch ruleset** (ou "Add rule" clássico).
2. Branch name pattern: `main`.
3. Marcar:
   - ✅ **Require a pull request before merging** → require **1 approval**.
   - ✅ **Require status checks to pass** → selecionar o check de CI (`verify` / build) quando o P0-CI estiver no ar.
   - ✅ **Require linear history**.
   - ✅ **Block force pushes**.
   - ✅ **Restrict deletions**.
4. (Opcional, recomendado) Criar `.github/CODEOWNERS` exigindo review em `src/app/api/**`, `src/lib/auth/**`, `prisma/migrations/**` — eu gero o arquivo.
5. Deploy via `vercel --prod` CLI passa a ser **break-glass** (só emergência).

---

## 5. O que fica comigo (código — PRs)

| Item | O que faço |
|------|-----------|
| P0-0 | Deletar ~70 arquivos `* 2.*` + CI guard |
| P0-2 | Rate-limit de auth falhar fechado |
| P0-6 | Cron `*/30` + `ORDER BY lastSyncedAt` (usa o índice do §2) |
| P0-10 | Sentry client |
| P0-11 | Assert de pooling no validate-env |
| P0-CASCADE | Soft-delete no disconnect |
| P0-12 | Brand grid via `groupBy` (+ índice próprio na migration, se preciso) |
| P0-CI | CI real (test:coverage + Postgres container) |
| Repoint `DATABASE_URL` | Eu faço via `vercel env` **quando o código de RLS landar** — não antes |

---

## Ordem sugerida

1. Você: §1 diagnóstico → me manda o resultado (confirma rolbypassrls + se RLS está enabled).
2. Você: §2 índice + §3 drill de restore + §4 branch protection (paralelo).
3. Eu: começo P0-0 → P0-2 → P0-6 → P0-10 → P0-11 → P0-CASCADE (PRs pequenos).
4. Depois (com MCP/branch de teste): spike de RLS — te entrego o script completo vetado.
