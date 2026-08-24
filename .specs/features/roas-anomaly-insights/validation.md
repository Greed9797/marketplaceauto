# Validation Report — roas-anomaly-insights

**Result**: PASS

**Verifier**: independente (autor ≠ verificador)
**Repo/branch**: W3-Marketplace @ `feat/drive-dashboard-notificacoes`
**Diff range**: `b306a3f..HEAD` (11 commits, T1–T10 + fix de gaps `627a75c`)
**Data**: 2026-08-24 (iteração 1) · 2026-08-24 (iteração 2, re-verificação)

---

## Verdict por história

| História | Verdict | Observação |
| --- | --- | --- |
| P1: Alerta queda ROAS nível conta Shopee | **PASS** | ROAS-01..06 todos com evidência; mutantes M1/M2/M-supp mortos; M3 morto na iteração 2 |
| P1: Estoque crítico com runway | **PASS** | STCK-03 coberto pelo teste novo em notification-rules.test.ts:209 (fix `627a75c`, validado por mutação in-place na iteração 2) |
| P1: Relatório ROAS 7/30/90 | **PASS** | REPT-01..04 evidenciados (agregador + UI + wiring page.tsx) |
| P2: Canais externos | **PASS** | CHAN-01..04 evidenciados; cardinalidade via schema `workspaceId @unique` |
| P2: Matriz causa→ação | **PASS** | ACTN-01..03 evidenciados; limites 7/8/14 exatos |

**VERDICT GERAL (iteração 2): PASS** — 22/22 ACs cobertos, ambos os gaps da iteração 1 fechados e re-testados por mutação, gates verdes.

---

## PASSO 1 — Evidência por acceptance criterion

Legenda: ⚠️ = número definido como default documentado na tabela Assumptions da spec, não no corpo do AC.

### P1: Alerta de queda de ROAS no nível conta (Shopee)

| AC | Evidência (arquivo:linha) | Asserção | Bate com a spec? |
| --- | --- | --- | --- |
| ROAS-01 queda <50% → `roas_drop` `warning` na conta | tests/unit/shopee-account-rule.test.ts:79-84 | `expect(drafts).toHaveLength(1)`; `expect(draft.type).toBe("roas_drop")`; `expect(draft.severity).toBe("warning")`; `expect(draft.entityId).toBe(ACCOUNT.id)` | ✅ Baseline ROAS 10 → recente 3 (razão 0.30 ∈ [0.25, 0.50)); vinculada à conta (`entityType: "connector_account"`) |
| ROAS-02 razão <25% → `critical` | tests/unit/shopee-account-rule.test.ts:98-99 | `expect(drafts[0]!.severity).toBe("critical")` | ✅ Baseline ROAS 10, recente ≈0.67 → razão ≈0.067 < 0.25 |
| ROAS-03 pisos R$50 / R$20 | tests/unit/shopee-account-rule.test.ts:105,111 | `await expect(detectShopeeAccountRoasDrop("ws-1")).resolves.toEqual([])` (baselineSpend 40; recentSpend 10) | ✅ Ambos os pisos exercitados abaixo do limite |
| ROAS-04 baseline ROAS < 3 não alerta | tests/unit/shopee-account-rule.test.ts:118 | `await expect(...).resolves.toEqual([])` (baseline 200/100 = ROAS 2) | ✅ |
| ROAS-05 lag 72h excluído da janela recente | tests/unit/roas-windows.test.ts:18; :26; tests/unit/shopee-account-rule.test.ts:162-164 | `expect(w.cutoff.toISOString()).toBe("2026-08-21T12:00:00.000Z")` (NOW=08-24T12:00Z); `expect(ATTRIBUTION_LAG_HOURS).toBe(72)`; `expect(new Date(firstCall.where.date.lt).toISOString()).toBe("2026-08-21T12:00:00.000Z")` | ✅ Exatamente 72h, unit + integração da regra. Contiguidade das janelas: roas-windows.test.ts:46-49 |
| ROAS-06 dedup 24h | tests/unit/notification-rules.test.ts:349-350 | `const second = await evaluateWorkspaceNotificationRules("ws-1"); expect(second).toBe(0)` | ✅ Duas execuções seguidas → 1 notificação apenas; janela `daysAgo(1)` em src/lib/notifications/rules.ts:74 |

### P1: Estoque crítico com runway

| AC | Evidência | Asserção | Bate com a spec? |
| --- | --- | --- | --- |
| STCK-01 limiares warning ≤5 / critical ≤2 mantidos | tests/unit/notification-rules.test.ts:146-147; :171-173 | `expect(drafts[0].severity).toBe("warning")` (estoque 3); `expect(drafts[0].severity).toBe("critical")` + `expect(drafts[0].metadata).toMatchObject({ stock: 1 })` | ✅ Fronteira critical bracketada (1≤2 < 3); ⚠️ valores exatos 5 e 2 não testados na borda (comportamento bracketado entre 3 e 40) |
| STCK-02 runway no corpo + metadata, teto aritmético | tests/unit/runway.test.ts:19-21; tests/unit/notification-rules.test.ts:219-223 | `expect(computeRunwayDays(4, 2)).toBe(2)`; `expect(computeRunwayDays(5, 2)).toBe(3)`; `expect(drafts[0].body).toContain("cerca de 2 dias")`; `expect(drafts[0].metadata).toMatchObject({ stock: 4, runwayDays: 2 })` | ✅ Âncora da spec (estoque 4, 2/dia → ≈2 dias). Janela 14d está NO TEXTO do AC (STCK-02), confirmada em runway.test.ts:11-12 |
| STCK-03 status ≠ publicado não gera | tests/unit/notification-rules.test.ts:209-220 (fix `627a75c`) | `expect(prismaMocks.produto.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "publicado" }) }))` | ✅ Asserção direta sobre o filtro no `where` do `findMany`; discriminada por mutação in-place (iteração 2, ver seção abaixo) — gap #1 **FECHADO** |
| STCK-04 média zero/indisponível omite runway sem bloquear | tests/unit/runway.test.ts:29-31; tests/unit/notification-rules.test.ts:253-255 | `expect(computeRunwayDays(10, 0)).toBeNull()` etc.; `expect(drafts[0].body).not.toContain("Estimativa")`; `expect("runwayDays" in (drafts[0].metadata as object)).toBe(false)` | ✅ Alerta segue criado (toHaveLength(1)) |
| STCK-05 fallback quantidade publicada | tests/unit/notification-rules.test.ts:145-148 | `expect(drafts).toHaveLength(1)` com inventário vazio e `quantidade: 3` | ✅ Cobertura implícita: draft só existe porque o fallback para `produto.quantidade` rodou (src/lib/notifications/rules.ts:372-373); valor do fallback não é assertido diretamente |

### P1: Relatório de ROAS 7/30/90 dias

| AC | Evidência | Asserção | Bate com a spec? |
| --- | --- | --- | --- |
| REPT-01 seletor 7/30/90 nas 5 métricas | tests/unit/roas-report-card.test.tsx:52-58; tests/unit/roas-report.test.ts:67-78; src/app/(app)/relatorios/page.tsx:19,38-39 | `for (const label of ["7 dias","30 dias","90 dias"]) expect(screen.getByRole("button",{name:label})).toBeInTheDocument()`; `expect(report.totals.spend).toBe(150)`; `expect(report.totals.roas).toBeCloseTo(800/150)`; `expect(report.totals.ctr).toBeCloseTo(70/1500)` | ✅ Regex da página `^(7|30|90)$` valida param `janela` |
| REPT-02 histórico parcial + aviso desde {data} | tests/unit/roas-report.test.ts:96-97; tests/unit/roas-report-card.test.tsx:92-95 | `expect(report.partialHistory).toBe(true)`; `expect(screen.getByText(/Histórico parcial: dados disponíveis a partir de/i)).toBeInTheDocument()` | ✅ Semântica igual; redação real é "Histórico parcial: dados disponíveis a partir de {data}" vs. spec "histórico desde {data}" (desvio cosmético) |
| REPT-03 filtro por plataforma soma só a fonte | tests/unit/roas-report.test.ts:128-135; tests/unit/roas-report-card.test.tsx:76-81 | `expect(metricWhere.source).toBe(ConnectorProvider.SHOPEE_ADS)`; `expect(orderWhere.platform).toBe(ConnectorProvider.SHOPEE_ADS)`; `expect(push).toHaveBeenCalledWith("/relatorios?date=2026-08-24&janela=30&fonte=SHOPEE_ADS")` | ✅ Propagado para métricas E pedidos |
| REPT-04 estado vazio orienta /connectors | tests/unit/roas-report.test.ts:141-150; tests/unit/roas-report-card.test.tsx:115-117; src/app/(app)/relatorios/roas-report-card.tsx:111-113 | `expect(report.days).toEqual([])`; `expect(report.totals).toMatchObject({ spend: 0, …, roas: null, ctr: null })`; `expect(screen.getByTestId("roas-empty")).toHaveTextContent(/Sem dados sincronizados/i)` | ✅ Componente renderiza "Conecte os anúncios em /connectors" |

### P2: Canais externos

| AC | Evidência | Asserção | Bate com a spec? |
| --- | --- | --- | --- |
| CHAN-01 payload completo ao webhook | tests/unit/notification-channels.test.ts:52-63 | `expect(result.delivered).toBe(1)`; `expect(JSON.parse(String(init.body))).toMatchObject({ workspace: "ws-1", type: "roas_drop", severity: "critical", title: …, entityId: "acc-1" })` | ✅ Payload contém workspace/tipo/severidade/título/corpo/metadata (buildPayload, channels.ts:66-77). ⚠️ "≤60s" não é assertível em unit; garantido por ausência de throttle + fire-and-forget pós-commit (rules.ts:498-507) |
| CHAN-02 retry 3× backoff + log final sem bloquear | tests/unit/notification-channels.test.ts:84-88 | `expect(fetchMock).toHaveBeenCalledTimes(3)`; `expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("webhook delivery failed"))`; função resolve com `{delivered: 0}` sem throw | ✅ Backoff exponencial vive em retry.ts pré-existente (`baseDelayMs * 2**attempt`, retry.ts:91); crescimento em si não é assertido (helper herdado) |
| CHAN-03 cooldown 24h não reentrega | tests/unit/notification-rules.test.ts:353-357 | `expect(dispatchNotificationsMock).toHaveBeenCalledTimes(1)` após 2ª execução em cooldown | ✅ Só criação nova vai ao canal |
| CHAN-04 máx 1 webhook + 1 e-mail por workspace | prisma/schema.prisma:116 (`workspaceId String @unique`); tests/unit/notification-channels.test.ts:120-124, 137-140 | `expect(result.delivered).toBe(0); expect(fetchMock).not.toHaveBeenCalled()` (sem canal / canal disabled) | ✅ Cardinalidade 1:1 imposta pelo schema (não testável sem DB); gating de entrega testado |

### P2: Matriz causa→ação

| AC | Evidência | Asserção | Bate com a spec? |
| --- | --- | --- | --- |
| ACTN-01 causa anexada ao `roas_drop` | tests/unit/notification-causes.test.ts:18-19; :28-29; :74-78; integração: src/lib/notifications/shopee-account-rule.ts:168-209 e rules.ts:241-264 | `expect(verdict?.cause).toContain("preço")`; `expect(verdict?.cause).toBe("queda de CTR")`; `expect(enriched.metadata).toMatchObject({ cause: "queda de CTR", suggestedAction: "testar novo criativo" })` | ✅ Conversão↓+CTR estável→preço/estoque; CTR↓→criativo/título. ⚠️ Limiares 0.85/0.75 são defaults documentados na spec (Assumptions); testes bracketam 0.85 entre razões 0.6 e 0.95 e 0.75 acima de 0.5, sem asserção na borda exata |
| ACTN-02 runway ≤7 repor já; 8–14 programar | tests/unit/notification-causes.test.ts:42-48 | `expect(stockAction(7)).toBe("repõe o estoque agora")`; `expect(stockAction(8)).toBe("programa a reposição ainda esta semana")`; `expect(stockAction(14)).toBe("programa a reposição ainda esta semana")` | ✅ Bordas exatas 7/8/14 assertidas; wiring em rules.ts:392-395 |
| ACTN-03 fallback recomendação genérica | tests/unit/notification-causes.test.ts:33-36; :81-83 | `expect(classifyRoasCause({})).toBeNull()`; `expect(withCause(base, null)).toEqual(base)` | ✅ Draft intacto quando sinais ausentes; texto genérico atual preservado |

---

## PASSO 2 — Sensor de discriminação (mutantes in-place)

Cada mutante: 1 edição mínima → `npx vitest run <arquivos-relacionados>` → revert via `git checkout --`.

| # | Arquivo | Mutante | Resultado | Teste que matou |
| --- | --- | --- | --- | --- |
| M1 | src/lib/notifications/roas-windows.ts | cutoff = now (lagHours ignorado) | **MORTO** (3 falhas) | roas-windows.test:15 "desloca o corte em exatamente 72 horas"; roas-windows.test:29 "aceita lag customizado"; shopee-account-rule.test:152 "aplica o lag de 72h…" |
| M2 | src/lib/notifications/shopee-account-rule.ts | BASELINE_MIN_SPEND 50→5 | **MORTO** (1 falha) | shopee-account-rule.test:102 "nao alerta com gasto baseline abaixo do piso de R$50" |
| M3 | src/lib/notifications/rules.ts | ROAS_DROP_RATIO_WARNING 0.5→0.9 | Iteração 1: **SOBREVIVEU** (12/12) → Iteração 2: **MORTO** (1 falha) após fix `627a75c` | notification-rules.test:106 "ignora campanha cuja razao fica em 50% ou mais" (`toHaveLength(0)` recebeu 1, test:119). Gap #2 **FECHADO** |
| M4 | src/lib/notifications/runway.ts | Math.ceil→Math.floor | **MORTO** (1 falha) | runway.test:18 "calcula dias restantes arredondando para cima" (`computeRunwayDays(5, 2)).toBe(3)`) |
| M5 | src/lib/notifications/channels.ts | maxAttempts 3→1 | **MORTO** (1 falha) | notification-channels.test:66 "reintenta ate 3 vezes…" (`fetchMock).toHaveBeenCalledTimes(3)`) |
| M6 | src/lib/notifications/causes.ts | STABLE_CTR_RATIO 0.85→0.05 | **MORTO** (1 falha) | notification-causes.test:22 "CTR em queda -> criativo/titulo" (razão 0.6 deixaria de ser "em queda") |
| M-supp | src/lib/notifications/shopee-account-rule.ts | DROP_RATIO_WARNING 0.5→0.9 (equivalente do M3 na regra da feature) | **MORTO** (1 falha) | shopee-account-rule.test:121 "nao alerta conta estavel (razao >= 50%)" |

### Gaps ranqueados

1. **[ALTO — bloqueia Done] STCK-03 sem teste.** O filtro `status: "publicado"` existe (rules.ts:283) mas nenhum teste o verifica; mocks de prisma contornam o `where`. tasks.md T5 declara "[x] Status ≠ publicado não alerta (teste novo)" — claim falso. Correção: 1 teste negativo.
2. [MÉDIO — pré-existente, fora dos ACs da feature] M3 sobreviveu: a regra de campanha legada (`detectRoasDrops`) não tem caso negativo "campanha estável (razão ≥ 50%) não alerta". O limiar equivalente da regra NOVA (nível conta) é bem discriminado (M-supp morto). Os ACs ROAS-01..06 mapeiam para a regra de conta, então isto não viola a spec desta feature — mas o threshold da regra antiga pode regredir sem quebrar a suíte. Sugestão: 1 teste negativo espelhando o da conta.

---

## Iteração 2 — Re-verificação dos fixes (`627a75c`, mesmo dia)

Autor aplicou ambos os fixes num único commit de teste (`627a75c`, +30 linhas em tests/unit/notification-rules.test.ts; arquivo 12→14 testes). Verificador independente re-executou o sensor nas duas mutações correspondentes.

### Fix do Gap #1 — STCK-03

- **Teste novo**: notification-rules.test.ts:209 `"so considera produtos publicados na consulta (STCK-03)"` — asserção em :216-218 confere `status: "publicado"` dentro do `where` de `produto.findMany`.
- **Mutação in-place**: `status: "publicado"` → `"rascunho"` em src/lib/notifications/rules.ts:283.
- **Resultado**: **FALHA** como esperado — `1 failed | 13 passed (14)`; falha exatamente em notification-rules.test.ts:216 (`toHaveBeenCalledWith` recebeu where com `status: "rascunho"`).
- **Revert**: `git checkout --` → árvore limpa.

### Fix do Gap #2 — mutante M3

- **Teste novo**: notification-rules.test.ts:106 `"ignora campanha cuja razao fica em 50% ou mais"` — baseline ROAS 10 vs recente ROAS 6 (razão 0.6 ∈ [0.5, 0.9)), asserção `expect(drafts).toHaveLength(0)` em :119.
- **Mutação in-place**: `ROAS_DROP_RATIO_WARNING = 0.5` → `0.9` em src/lib/notifications/rules.ts:35.
- **Resultado**: **FALHA** como esperado — `1 failed | 13 passed (14)`; M3 morto, falha em notification-rules.test.ts:119 (`toHaveLength(0)` recebeu `[1] item`).
- **Revert**: `git checkout --` → árvore limpa.

---

## PASSO 3 — Gates finais (estado original, mutantes revertidos)

Re-executados na iteração 2 sobre `627a75c`:

| Gate | Comando | Resultado |
| --- | --- | --- |
| Testes | `npx vitest run` | ✅ **371 passed (371)** / 76 arquivos (iteração 1: 369; +2 testes do fix) |
| Typecheck | `npm run typecheck` (tsc --noEmit) | ✅ sem erros |
| Lint | `npm run lint` | ✅ 0 erros, 2 warnings (tests/unit/notification-channels.test.ts:38 params `_url`/`_init` prefixados e não usados — intencional no mock de fetch) |
| Árvore limpa | `git status --porcelain` | ✅ vazia de modificações tracked após os reverts; apenas untracked PRÉ-existentes (`.specs/STATE.md`, `.specs/features/kit-generator/`, `scripts/reset-password.mjs`, `validation.md` deste relatório) |

## Contagem de testes antes/depois

| Base `b306a3f` | HEAD (`627a75c`) | Delta |
| --- | --- | --- |
| **322 passed** (confirmado em worktree descartável, iteração 1) | **371 passed** | **+49** |

Distribuição dos novos: roas-windows 7 · shopee-account-rule 9 · runway 4 · notification-rules +6 (14 no arquivo; +4 na iteração 1, +2 no fix) · roas-report 5 · roas-report-card 5 · notification-channels 5 · notification-causes 8.

## Conclusão

Feature sólida: **22/22 ACs com evidência correta e valores conferidos contra a spec**, sensor matou 7/7 mutantes (M3 morto pelo teste novo da iteração 2), gates verdes. Ambos os gaps da iteração 1 fechados e re-verificados por mutação in-place com revert limpo. **Done aprovado.**
