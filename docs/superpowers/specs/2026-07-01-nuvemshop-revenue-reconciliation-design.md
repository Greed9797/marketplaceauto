# NuvemShop Revenue Reconciliation — Design

Data: 2026-07-01
Autor: brainstorming session (bug report Gustavo / loja Cotton Chic)
Status: aprovado (approach B) — pronto para writing-plans

## 1. Sintoma

Dashboard "tráfego pago" (adstart-w3) mostra Faturamento **R$ 31.640,09 / 77 vendas**
para Cotton Chic no período 01/06–30/06/2026. O painel do próprio NuvemShop mostra
Receita **R$ 43.922,29 / 102–103 pedidos pagos** para o mesmo período. Divergência de
~28% (R$ 12.282), sub-reportando faturamento — o que também distorce ROAS/ROI, o
produto central do app.

## 2. Diagnóstico (validado contra a API do NuvemShop, read-only)

Fonte: consulta direta à API de orders do NuvemShop (store 5077392) + queries no DB
(schema `w3ads`) + leitura do código do conector.

- **Fonte da verdade do NuvemShop:** Receita = `sum(total)` dos pedidos **pagos e
  não-cancelados**, agrupados por **`created_at` (data de criação)**. Confirmado:
  102 pedidos → R$ 43.922,29 (== nº reportado pelo usuário).
- **Valor por pedido está correto:** `total == total_paid` (43922.29 em ambos). A
  hipótese inicial de subvalorização por frete está **descartada**. É puramente
  pedido faltando.
- **Gap = ~26 pedidos pagos ausentes do DB.** A réplica exata do fetch do app,
  rodada agora, retorna 103 pedidos pagos; o DB só tem 77. Ou seja: ~26 pedidos
  criados em junho viraram `paid` **depois** da última varredura de junho e nunca
  foram recapturados.
- **`paid_at` é não-confiável:** vazio/inválido em 77 de 102 pedidos pagos. Bucketar
  por `paid_at` (o atual `placedAt`) é frágil.

### Causas raiz (código confirmado)

**P1 — Sync recorrente sem lookback e sem `updated_at` (dominante).**
`computeForegroundRange()` (`src/lib/connectors/sync-range.ts:75-82`) varre apenas
`[início do mês UTC atual, hoje]`. O fetch (`src/lib/connectors/nuvemshop/client.ts`,
`ordersUrl`) filtra por `created_at` + `payment_status=paid`. Consequência: um pedido
criado em junho, ainda `pending` na última varredura de junho, não é puxado; quando é
pago em julho, a janela de julho só cobre `created_at` de julho → a janela de junho
nunca é revisitada → pedido perdido para sempre. A API do NuvemShop suporta
`updated_at_min`/`updated_at_max`, mas o conector nunca usa.

**P2 — Bucketing por `paid_at` em vez de `created_at`.**
`placedAt = pickValidIsoDate(paid_at, completed_at, created_at)`
(`nuvemshop/client.ts`) e a agregação filtra por `placedAt`
(`aggregator.ts` filtro placedAt; `ecommerce-sync.ts` `recomputeEcommerceDailyMetricsFromDb`).
O NuvemShop reporta por data de criação; o app por data de pagamento. Além de não
bater, `paid_at` está vazio em 75% dos casos.

**P3 — `skippedInvalidDate` silencioso (secundário/observabilidade).**
`persistOrdersOnly` (`src/lib/connectors/ecommerce-sync.ts`) pula pedidos com
`placedAt` inválido e só faz `console.warn`. Como `created_at` é sempre válido, o skip
raramente dispara hoje — mas fica invisível quando dispara.

### Nota de ambiente (não é o bug)

`.env` local aponta `?schema=w3marketplace` (schema **vazio**). Produção usa o schema
`w3ads` (955 pedidos, sync fresco). Debug local aponta pro schema errado — corrigir o
`.env` local ou documentar para evitar diagnóstico falso.

## 3. Solução (Approach B — bater igual ao NuvemShop)

Objetivo: `Faturamento(app, período P) == Receita(NuvemShop, período P)` para qualquer
período, de forma robusta a pagamentos tardios e reembolsos.

### 3.1 Schema
- Adicionar `orderCreatedAt DateTime` em `EcommerceOrder` (= `order.created_at` do
  NuvemShop). Índice `@@index([workspaceId, platform, orderCreatedAt])`.
- Manter `placedAt` (paid_at) para usos secundários; a **receita passa a agrupar por
  `orderCreatedAt`**.

### 3.2 Coleta (client)
- Parametrizar `ordersUrl` para aceitar filtro por `updated_at_min/max` além de
  `created_at`. Novo caminho de sync incremental por `updated_at`.
- Sync incremental deixa de filtrar `payment_status=paid` na API: usa `status=any` e
  puxa todos os status, gravando cada um com seu `payment_status`. A receita é
  decidida na agregação (paid & não-cancelado), não no fetch. Isso captura transições
  `pending→paid` e `paid→refunded/voided`.

### 3.3 Sync recorrente
- Substituir a janela "mês atual por created_at" por incremental por `updated_at`:
  `updated_at_min = lastSyncedAt − overlap` (ex.: −48h de folga), `status=any`, upsert.
- Manter o backfill histórico por `created_at` (`computeBackfillBatch`) para carga
  inicial; o incremental cobre o resto.

### 3.4 Agregação / dashboard
- `recomputeEcommerceDailyMetricsFromDb` e o filtro do `aggregator.ts` passam a usar
  `orderCreatedAt` (com o mesmo offset BRT já aplicado, `brtBound`).
- Regra de receita: `payment_status ∈ APROVADOS` **e** `status != cancelled`; somar
  `total_paid` (== `total`). A lógica de status aprovado/rejeitado
  (`order-status.ts`) já cobre isso.

### 3.5 Reparo de dados (one-time)
- Rodar um re-backfill de junho (e histórico afetado) por `updated_at`/`status=any`
  para popular `orderCreatedAt` e ingerir os ~26 pedidos faltantes.
- Critério de aceite: Cotton Chic, junho, `sum(total_paid)` de pagos não-cancelados
  por `orderCreatedAt` == R$ 43.922,29 (± reembolsos posteriores).

### 3.6 Observabilidade
- Persistir/alertar `skippedInvalidDate` (contador em `lastSyncError` ou métrica), em
  vez de só `console.warn`.

## 4. Timezone
Loja é BRT (UTC-3). Fronteira de "junho por data de criação" em UTC:
`[2026-06-01T03:00:00Z, 2026-07-01T03:00:00Z)`. Aplicar `brtBound` sobre
`orderCreatedAt` de forma consistente na agregação.

## 5. Testes
- `tests/unit/dashboard-period.test.ts` (existe) — adicionar casos:
  - pedido criado em junho, pago em julho → contado em **junho**.
  - `paid_at` vazio → usa `orderCreatedAt`, não é pulado.
  - `status=cancelled`/`voided` → receita zero.
  - fronteira BRT (pedido às 23:30 BRT de 30/06).
- Teste de reconciliação: dado um conjunto de orders mock do NuvemShop, o total
  agregado por `orderCreatedAt` == soma esperada.
- `npx vitest run` verde antes de deploy.

## 6. Rollout
1. Migration (add `orderCreatedAt` + índice).
2. Deploy do conector/agregação (backward-compatible: `orderCreatedAt` nullable no
   início, fallback para `created_at`/`placedAt` enquanto não backfillado).
3. Re-backfill de junho + histórico.
4. Verificar Cotton Chic junho == R$ 43.922,29.
5. Remover fallback quando `orderCreatedAt` estiver populado em 100%.

## 7. Fora de escopo (futuro)
- **Webhooks NuvemShop** (`order/paid`, `order/updated`) para reconciliação em tempo
  real (Approach C). Hardening posterior; polling incremental por `updated_at` já
  resolve o gap.

## 8. Arquivos-alvo
- `prisma/schema.prisma` — modelo `EcommerceOrder`.
- `src/lib/connectors/nuvemshop/client.ts` — `ordersUrl`, `listOrders`, normalização.
- `src/lib/connectors/sync-range.ts` — janela recorrente.
- `src/lib/workspace/sync-orchestrator.ts` — orquestração foreground/backfill.
- `src/lib/connectors/ecommerce-sync.ts` — persistência, recompute, skip metric.
- `src/lib/metrics/aggregator.ts` — filtro/bucketing por data.
- `tests/unit/dashboard-period.test.ts` — cobertura.
