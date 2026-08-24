# Kit Generator Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/kit-generator/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (validação antes de "feito"), `vitest.config.ts` (thresholds 70%), `eslint.config.mjs`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Engine de compatibilidade (domínio puro) | unit | Todas as camadas 1–3; 1:1 com ACs KIT-06..12; edge cases da spec | `tests/unit/kit-engine.test.ts` | `npx vitest run tests/unit` |
| Serviços (classify/proposals/publish) | unit | 1:1 com ACs; falha de IA, retry, hash anti-reproposta | `tests/unit/kit-*.test.ts` | `npx vitest run tests/unit` |
| Route handlers `/api/kits/*` | integration | Happy + edge + erro + gate admin por rota (padrão `client-error-route.test.ts`) | `tests/unit/kits*.route.test.ts` | `npx vitest run tests/unit` |
| UI `/kits` | unit | Estados: lista, filtros, aprovação, bloqueio, vazio | `tests/unit/kits-page.test.tsx` | `npx vitest run tests/unit` |
| Schema/migrations | none | - (build gate) | - | build gate |

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

### Phase 1: Fundações — schema e IA

```
T1 → T2
```

### Phase 2: Classificação

```
T3 → T4
```

### Phase 3: Motor e propostas

```
T5 → T6
```

### Phase 4: API e revisão humana

```
T7 → T8
T7 → T9
```

### Phase 5: Publicação (P2)

```
T10 → T11
```

---

## Task Breakdown

### T1: Modelos de dados do kit

**Status**: Complete

**What**: Adicionar `ProductClassification`, `ComplementaryPair`, `KitProposal`, `Kit` ao schema + migration idempotente.
**Where**: `prisma/schema.prisma` (+ diretório de migration correspondente)
**Depends on**: None
**Reuses**: convenções do schema (cuid ids, cascade, @@unique)
**Requirement**: KIT-01, KIT-04, KIT-14 (persistência dos contratos)

**Done when**:

- [x] `npx prisma validate` OK; client gerado; migration sem destructive
- [x] Unique em ProductClassification.produtoId e KitProposal.comboHash
- [x] Gate check passes: Full + `npx next build`

**Tests**: none
**Gate**: build

---

### T2: Cliente Gemini compartilhado

**Status**: Complete

**What**: Extrair chamada REST generateContent + strip de fences para `src/lib/ai/gemini.ts` com `generateJson<T>`; `ai-copy.ts` passa a consumi-lo.
**Where**: `src/lib/ai/gemini.ts`
**Depends on**: T1
**Reuses**: lógica atual de `src/lib/publisher/ai-copy.ts`
**Requirement**: KIT-01 (infra)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Testes existentes de ai-copy continuam verdes (nenhum comportamento mudado)
- [x] Teste novo: resposta com fences/ruído é normalizada
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T3: Serviço de classificação IA

**Status**: Complete

**What**: Implementar `classifyProduto`/`classifyBatch`: prompt estruturado, Zod do contrato de atributos, confiança <0.7 → needsReview, falha de IA não interrompe o lote, pulo de itens com `source=manual`.
**Where**: `src/lib/kits/classify.ts`
**Depends on**: T1, T2
**Reuses**: gemini client (T2)
**Requirement**: KIT-01, KIT-02, KIT-03, KIT-04, KIT-05

**Done when**:

- [x] Unit tests com Gemini mockado: feliz, baixa confiança, erro de rede, override manual preservado
- [x] Lote ≤50 com retomada determinística testado
- [x] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T4: Rota de classificação em lote

**Status**: Complete

**What**: Criar `POST /api/kits/classify` restrito a quem opera o workspace, processando ≤50 produtos pendentes por chamada e retornando contadores (processados/revisão/falhas).
**Where**: `src/app/api/kits/classify/route.ts`
**Depends on**: T3
**Reuses**: guard de auth/permissões das rotas existentes
**Requirement**: KIT-03, KIT-05

**Done when**:

- [x] Sem sessão → redirect/401; sem permissão → 403
- [x] Rate limit herdado do middleware app-tier
- [x] Route test cobre happy/edge/erro (padrão client-error-route)
- [x] Gate check passes: Full

**Tests**: integration
**Gate**: full

---

### T5: Engine de compatibilidade (pura)

**What**: Implementar `buildProposals`: camada 1 rígida (gender+ageBand, unissex cruza ambos), homogêneos 2–5 itens, pares complementares aprovados, trava de estoque ≥min, preço ≤5×, preferência cor distinta + flag monocromático, ordenação giro alto+lento, motivo legível.
**Where**: `src/lib/kits/engine.ts`
**Depends on**: T1
**Reuses**: tipos gerados pelo prisma (T1)
**Requirement**: KIT-06, KIT-07, KIT-08, KIT-09, KIT-10, KIT-11, KIT-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Um teste por AC (KIT-06..12) com catálogo sintético
- [ ] Pares inválidos (gênero divergente, estoque 1, preço 10x) descartados
- [ ] Função pura: nenhum IO
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T6: Persistência de propostas

**What**: Implementar `generateProposals(clienteId)`: carrega classificados+estoque+pares ativos, roda engine, persiste propostas com comboHash canônico; rejeitadas não voltam.
**Where**: `src/lib/kits/proposals.ts`
**Depends on**: T5
**Reuses**: engine (T5), fontes de estoque da regra low_stock
**Requirement**: KIT-14, KIT-12

**Done when**:

- [ ] Hash canônico independente de ordem dos componentes (teste)
- [ ] Proposta rejeitada não reaparece (teste)
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T7: Rotas de propostas (listar/aprovar/rejeitar)

**What**: Criar `GET/PATCH /api/kits/proposals`: listagem filtrável por status/cliente; aprovar persiste `Kit` com preço informado; rejeitar grava status; estoque abaixo do mínimo marca kit `bloqueado`.
**Where**: `src/app/api/kits/proposals/route.ts`
**Depends on**: T6
**Reuses**: guard de auth; validação Zod
**Requirement**: KIT-13, KIT-14, KIT-15, KIT-16

**Done when**:

- [ ] Route tests: happy/edge/erro + gate de permissão
- [ ] Aprovação cria Kit 1:1 com Proposal (teste)
- [ ] Componente sem estoque → bloqueio automático (teste)
- [ ] Gate check passes: Full

**Tests**: integration
**Gate**: full

---

### T8: UI de revisão de kits

**What**: Criar página `/kits` com lista de propostas (motivo, componentes, preço sugerido), ações aprovar/rejeitar com preço editável, filtros por status/cliente, fila "revisão manual" da classificação e botão de acionar classificação. Client component coeso na mesma feature folder.
**Where**: `src/app/(app)/kits/page.tsx`
**Depends on**: T4, T7
**Reuses**: padrões visuais/tokens das páginas existentes
**Requirement**: KIT-16, KIT-02 (fila de revisão visível)

**Done when**:

- [ ] Component test: render de estados proposta/aprovado/bloqueado/vazio
- [ ] Fluxo aprovar→kit aparece como aprovado na lista (integração mockada)
- [ ] Gate check passes: Full

**Tests**: unit
**Gate**: full

---

### T9: Serviço de publicação de kits (P2)

**What**: Implementar `publishKitBatch(kitIds)`: valida estoque no momento da publicação, monta anúncio kit (imagens+preço) via fluxo Shopee existente, status por kit (`publicado`/`erro`), falha isolada não interrompe lote.
**Where**: `src/lib/kits/publish.ts`
**Depends on**: T7
**Reuses**: `src/lib/publisher/shopee-publish.ts`
**Requirement**: KPUB-01, KPUB-02, KPUB-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Unit tests com publisher mockado: sucesso, falha isolada, estoque insuficiente → pula e bloqueia
- [ ] Relatório parcial retornável {publicado, erros[]}
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit
**Gate**: quick

---

### T10: Rota de publicação em lote (P2)

**What**: Criar `POST /api/kits/publish` recebendo kitIds aprovados, executando publishKitBatch com gate de permissão e retorno parcial.
**Where**: `src/app/api/kits/publish/route.ts`
**Depends on**: T9
**Reuses**: guards das rotas kits
**Requirement**: KPUB-01, KPUB-02

**Done when**:

- [ ] Route tests happy/edge/erro + permissão
- [ ] Kit sem estoque no publish → 200 parcial com kit marcado bloqueado
- [ ] Gate check passes: Full

**Tests**: integration
**Gate**: full

---

### T11: Botão publicar em lote na UI (P2)

**What**: Adicionar seleção múltipla e botão "Publicar selecionados" na lista de kits aprovados com relatório parcial pós-ação.
**Where**: `src/app/(app)/kits/kits-client.tsx` (modify)
**Depends on**: T8, T10
**Reuses**: componentes da própria página (T8)
**Requirement**: KPUB-01, KPUB-02

**Done when**:

- [ ] Component test: seleção + relatório parcial exibido
- [ ] Gate check passes: `npx vitest run && npm run lint`

**Tests**: unit
**Gate**: full

---

## Phase Execution Map

Edges declaradas (todas apontam para trás ou dentro da mesma fase):

```
T1 → T2
T1 → T3
T2 → T3
T3 → T4
T1 → T5
T5 → T6
T6 → T7
T4 → T8
T7 → T8
T7 → T9
T9 → T10
T8 → T11
T10 → T11
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order. Nenhuma tarefa depende de fase posterior.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 modelos+migration | 1 arquivo de schema | ✅ Granular |
| T2 cliente Gemini | 1 módulo extraído | ✅ Granular |
| T3 classify service | 1 módulo | ✅ Granular |
| T4 route classify | 1 endpoint | ✅ Granular |
| T5 engine pura | 1 módulo puro | ✅ Granular |
| T6 proposals service | 1 módulo | ✅ Granular |
| T7 routes proposals | 1 endpoint (GET/PATCH coesos) | ✅ Granular |
| T8 UI /kits | 1 página (+client coeso) | ✅ Granular |
| T9 publish service | 1 módulo | ✅ Granular |
| T10 route publish | 1 endpoint | ✅ Granular |
| T11 botão publicar | 1 componente modificado | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | início P1 | ✅ Match |
| T2 | None | início P1 | ✅ Match |
| T3 | T1, T2 | T1→T3, T2→T3 | ✅ Match |
| T4 | T3 | T3→T4 | ✅ Match |
| T5 | T1 | T1→T5 (cross-phase, para trás) | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T6 | T6→T7 (cross-phase, para trás) | ✅ Match |
| T8 | T4, T7 | T4→T8, T7→T8 | ✅ Match |
| T9 | T7 | T7→T9 (cross-phase, para trás) | ✅ Match |
| T10 | T9 | T9→T10 | ✅ Match |
| T11 | T8, T10 | T8→T11, T10→T11 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | schema | none | none | ✅ OK |
| T2 | serviço IA | unit | unit | ✅ OK |
| T3 | serviço classify | unit | unit | ✅ OK |
| T4 | route handler | integration | integration | ✅ OK |
| T5 | domínio puro | unit | unit | ✅ OK |
| T6 | serviço proposals | unit | unit | ✅ OK |
| T7 | route handler | integration | integration | ✅ OK |
| T8 | UI page | unit | unit | ✅ OK |
| T9 | serviço publish | unit | unit | ✅ OK |
| T10 | route handler | integration | integration | ✅ OK |
| T11 | UI component | unit | unit | ✅ OK |
