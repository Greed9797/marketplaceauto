# ROAS Anomaly & Insights Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/roas-anomaly-insights/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (validação antes de "feito"), `vitest.config.ts` (thresholds 70%), `eslint.config.mjs`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Regras/motor de notificação (domínio) | unit | Todos os ramos; 1:1 com ACs; edge cases listados na spec | `tests/unit/notification-rules.test.ts`, `tests/unit/*roas*.test.ts` | `npx vitest run tests/unit` |
| Métricas/relatório (domínio) | unit | 1:1 com ACs REPT; janelas parciais e vazias | `tests/unit/*report*.test.ts` | `npx vitest run tests/unit` |
| Route handlers novos | integration | Happy + edge + erro por rota (padrão `client-error-route.test.ts`) | `tests/unit/*.route.test.ts` | `npx vitest run tests/unit` |
| UI components | unit | Render de estados: janelas, filtro, vazio, parcial | `tests/unit/*relatorio*.test.tsx` | `npx vitest run tests/unit` |
| Schema/config | none | - (build gate) | - | build gate |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Tasks com testes unit novos | `npx vitest run` |
| Full | Após fase completa ou rotas | `npx vitest run && npm run lint && npm run typecheck` |
| Build | Tarefa de schema/config | Full + `npx next build` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Motor conta-Shopee (P1)

```
T1 → T2 → T3
```

### Phase 2: Runway de estoque (P1)

```
T4 → T5
```

### Phase 3: Relatórios 7/30/90d (P1)

```
T6 → T7
```

### Phase 4: Canais externos (P2)

```
T8 → T9
```

### Phase 5: Matriz causa→ação (P2)

```
T10
```

---

## Task Breakdown

### T1: Janelas com lag de atribuição (puro)

**What**: Criar funções puras `computeLaggedWindows` e `roasRatio` com constante exportada `ATTRIBUTION_LAG_HOURS = 72`.
**Where**: `src/lib/notifications/roas-windows.ts`
**Depends on**: None
**Reuses**: semântica de janelas contíguas de `rules.ts`
**Requirement**: ROAS-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Lag aplicado ao corte da janela recente por timestamp
- [x] Razão = recente/baseline com guard para baseline 0
- [x] `Tests/unit` cobre: lag 72h, bordas de janela contíguas, baseline zero
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T2: Regra de queda no nível conta Shopee

**What**: Implementar `detectShopeeAccountRoasDrop`: spend agregado de `DailyMetric(source=SHOPEE_ADS)` × receita de `EcommerceOrder` nas mesmas janelas do T1, pisos R$50/R$20, baseline ROAS ≥3, severidades warning/critical.
**Where**: `src/lib/notifications/shopee-account-rule.ts`
**Depends on**: T1
**Reuses**: constantes/padrão de drafts de `src/lib/notifications/rules.ts`
**Requirement**: ROAS-01, ROAS-02, ROAS-03, ROAS-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Conta revogada/expirada não gera alerta (join com ConnectorAccount ativo)
- [x] Draft inclui entityId=connectorAccountId, métricas em metadata
- [x] Unit tests mockam prisma e cobrem cada limiar (ACs ROAS-01..04)
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T3: Integração da regra no avaliador

**What**: Adicionar a nova regra ao `evaluateWorkspaceNotificationRules` (Promise.all com catch próprio); dedup 24h herdado via persistDrafts.
**Where**: `src/lib/notifications/rules.ts` (modify)
**Depends on**: T2
**Reuses**: persistDrafts/advisory lock existentes
**Requirement**: ROAS-01, ROAS-06

**Done when**:

- [x] Duas execuções seguidas criam 1 notificação apenas (teste de cooldown)
- [x] Falha da regra não derruba as demais (teste de catch)
- [x] Test count cresce sem deletar testes existentes
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T4: Runway puro

**What**: Criar `computeRunwayDays(stock, unitsPerDay)` arredondando para cima, retornando null quando média indisponível/zero.
**Where**: `src/lib/notifications/runway.ts`
**Depends on**: None
**Reuses**: nenhum
**Requirement**: STCK-02, STCK-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Casos: média >0, média 0, null — todos com teste
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T5: Runway embutido no alerta de estoque

**What**: `detectLowStock` calcula média diária de unidades (pedidos 14d por produto/SKU) e anexa runway ao corpo+metadata; reforça filtro status `publicado`.
**Where**: `src/lib/notifications/rules.ts` (modify)
**Depends on**: T4
**Reuses**: `computeRunwayDays`, fontes de estoque atuais
**Requirement**: STCK-01, STCK-02, STCK-03, STCK-04, STCK-05

**Done when**:

- [x] Produto publicado c/ estoque 4 e 2/dia → corpo traz "≈2 dias"
- [x] Sem pedidos → alerta segue sem runway
- [x] Status ≠ publicado não alerta (teste novo)
- [x] Gate check passes: `npx vitest run && npm run typecheck`

**Tests**: unit
**Gate**: quick

---

### T6: Agregador de relatório 7/30/90d

**What**: `getRoasReport(workspaceId, windowDays, source?)` retornando série diária, totais (spend/revenue/ROAS/orders/CTR), `firstDataDate` e flag `partialHistory`.
**Where**: `src/lib/metrics/roas-report.ts`
**Depends on**: None
**Reuses**: padrões de consulta de `general-overview.ts`
**Requirement**: REPT-01, REPT-02, REPT-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Janela > histórico retorna dados disponíveis + partialHistory=true
- [x] Filtro por fonte isola Shopee Ads / ML Ads
- [x] Workspace vazio → série vazia sem erro
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T7: UI de relatórios com janelas e filtro

**What**: Adicionar seletor 7/30/90d, filtro por plataforma, aviso de histórico parcial e estado vazio ao cliente de relatórios; a página correspondente passa os dados do T6 ao componente.
**Where**: `src/app/(app)/relatorios/roas-report-card.tsx`
**Depends on**: T6
**Reuses**: componentes/tokens visuais existentes do app
**Requirement**: REPT-01, REPT-02, REPT-03, REPT-04

**Done when**:

- [x] Renderiza três janelas com totais conferíveis (dados sintéticos no teste)
- [x] Aviso parcial aparece quando partialHistory
- [x] Estado vazio quando sem dados
- [x] Gate check passes: `npx vitest run && npm run lint`

**Tests**: unit
**Gate**: full

---

### T8: Modelo NotificationChannel

**What**: Adicionar modelo 1:1 por workspace (`webhookUrl?`, `notifyEmail?`, `enabled`) + migration idempotente.
**Where**: `prisma/schema.prisma` (+ diretório de migration correspondente)
**Depends on**: None
**Reuses**: convenções do schema (cascade, updatedAt)
**Requirement**: CHAN-04

**Done when**:

- [x] `npx prisma validate` OK e client gerado
- [x] Migration SQL revisada (sem destructive)
- [x] Gate check passes: Full + `npx next build`

**Tests**: none
**Gate**: build

---

### T9: Dispatcher webhook + e-mail

**What**: `dispatchNotifications` entrega cada notificação recém-criada ao canal configurado (payload workspace/tipo/severidade/título/corpo/metadata), 3 retries backoff, falha final logada; chamado fire-and-forget após persistDrafts.
**Where**: `src/lib/notifications/channels.ts`
**Depends on**: T8
**Reuses**: `callWithRetry`, `src/lib/email/resend.ts`
**Requirement**: CHAN-01, CHAN-02, CHAN-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Webhook mock recebe payload <60s (sem throttle artificial no teste)
- [x] 3 retries com backoff e log final (testado com fetch mockado)
- [x] Cooldown: notificações antigas não reentregam
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T10: Matriz causa→ação nos alerts

**What**: `attachRecommendation` escolhe causa provável (conversão↓+CTR estável → preço/estoque; CTR↓ → criativo/título; runway ≤7d → repor já) e anexa em metadata/body dos drafts; fallback mantém texto atual.
**Where**: `src/lib/notifications/causes.ts`
**Depends on**: None
**Reuses**: tipos de draft e sinais calculados em runtime pelas janelas/runway
**Requirement**: ACTN-01, ACTN-02, ACTN-03

**Done when**:

- [ ] Cada linha da matriz tem teste 1:1
- [ ] Sinais ausentes → recomendação genérica preservada
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Phase 1:  T1 ------→ T2 ------→ T3
Phase 2:  T4 ------→ T5
Phase 3:  T6 ------→ T7
Phase 4:  T8 ------→ T9
Phase 5:  T10
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 windows puras | 1 arquivo/funções puras | ✅ Granular |
| T2 regra conta-Shopee | 1 função detectora | ✅ Granular |
| T3 wiring avaliador | 1 arquivo modificado | ✅ Granular |
| T4 runway puro | 1 função | ✅ Granular |
| T5 enriquecimento low_stock | 1 função modificada | ✅ Granular |
| T6 agregador relatório | 1 módulo | ✅ Granular |
| T7 UI relatórios | 1 client component (+ wiring) | ✅ Granular |
| T8 schema channel | 1 modelo+migration | ✅ Granular |
| T9 dispatcher canais | 1 módulo | ✅ Granular |
| T10 matriz causas | 1 módulo | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | início P1 | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | None | início P2 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | None | início P3 | ✅ Match |
| T7 | T6 | T6→T7 | ✅ Match |
| T8 | None | início P4 | ✅ Match |
| T9 | T8 | T8→T9 | ✅ Match |
| T10 | None | início P5 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | domínio (puro) | unit | unit | ✅ OK |
| T2 | domínio | unit | unit | ✅ OK |
| T3 | domínio (wiring) | unit | unit | ✅ OK |
| T4 | domínio (puro) | unit | unit | ✅ OK |
| T5 | domínio | unit | unit | ✅ OK |
| T6 | métricas | unit | unit | ✅ OK |
| T7 | UI component | unit | unit | ✅ OK |
| T8 | schema | none | none | ✅ OK |
| T9 | dispatcher (fetch/email) | unit | unit | ✅ OK |
| T10 | domínio | unit | unit | ✅ OK |
