# Google Sheets / WhatsApp

> Categoria: **E-commerce** · Modo: **Manual (CSV público)** · Janela de backfill: **período da planilha**

Conector especial para lojas que **vendem via WhatsApp** ou outros canais não automatizados. O cliente preenche uma planilha diária; W3ADS lê o CSV exportado e gera métricas como se fossem pedidos.

---

## O que esse conector traz pro dashboard

- Vendas diárias agregadas (qtd + valor) → `EcommerceOrder` sintéticos
- Soma no KPI **Faturamento** junto com Shopify/Nuvemshop/etc.

Tabelas: `EcommerceOrder` (com `pedido = GOOGLE_SHEETS-YYYY-MM-DD`, `origem = whatsapp`), `DailyMetric` (source=`GOOGLE_SHEETS`).

---

## Antes de começar

- [ ] Acesso a uma planilha Google Sheets que o cliente preenche.
- [ ] A planilha precisa estar com **"Qualquer pessoa com o link pode visualizar"** (permission share).
- [ ] Header da aba relevante deve conter as colunas exatas: `Dia`, `Qtd. Vendas`, `Valor em vendas` (parser ignora acentos/caixa).

---

## 1. Preparar a planilha

Exemplo de estrutura aceita:

| Dia | Qtd. Vendas | Valor em vendas | Ticket Médio |
|---|---|---|---|
| 01/05/2026 | 0 | R$ 0,00 | — |
| 02/05/2026 | 11 | R$ 2.848,75 | R$ 258,98 |
| 03/05/2026 | 8 | R$ 2.142,80 | R$ 267,85 |

Regras do parser ([src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) `extractDailyGoogleSheetPayloads`):

- **Datas BR (`DD/MM/YYYY`)** ou ISO (`YYYY-MM-DD`) — ambos aceitos.
- **Moeda BR** (`R$ 1.234,56`) com pontos de milhar + vírgula decimal — normalizado pra float.
- **Linhas com qtd=0 OU valor=0 são ignoradas** (não viram pedido).
- O parser procura **a primeira linha** que contém `Dia`, `Qtd. Vendas` e `Valor em vendas` — anteriores podem ser título (ex: nome da loja).
- Linha de totais no final é ignorada automaticamente porque não tem data.

Cada linha vira um `EcommerceOrder` com:
- `pedido = "GOOGLE_SHEETS-2026-05-02"`
- `valor = 2848.75`
- `status = "APPROVED"`
- `origem = "whatsapp"`
- `data = "2026-05-02T00:00:00.000Z"`
- `qtd_vendas = 11`

---

## 2. Compartilhar a planilha

1. Abra a planilha → **Compartilhar** (canto superior direito).
2. **Acesso geral → Qualquer pessoa com o link → Visualizador**.
3. Copie o **link da aba específica** (com `#gid=...`).

> A planilha não precisa ficar pública pra busca, só "com o link". O W3ADS lê o CSV via endpoint `export?format=csv&gid=<gid>` que o Google expõe pra planilhas com esse share level.

---

## 3. Conectar no W3ADS

`/connectors` → card Google Sheets / WhatsApp → preencha:

| Campo | Valor | Obrigatório |
|---|---|---|
| Base URL | URL completa da planilha (com `#gid=...`) | sim |
| Orders Path | `gid` da aba (opcional se já está na URL) | não |
| API Key/User/Password | — | não usar |

Exemplo:
```
Base URL: https://docs.google.com/spreadsheets/d/14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV/edit?gid=1004138552#gid=1004138552
Orders Path: 1004138552
```

O W3ADS extrai:
- **Sheet ID**: `14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV` (regex `/spreadsheets/d/([^/]+)`)
- **GID**: `1004138552` (do query param ou do orders path)

E monta a URL de download CSV:
```
https://docs.google.com/spreadsheets/d/14h4veQ1W9Qfv5mHGyFqcwdBDLwIDUKlV/export?format=csv&gid=1004138552
```

healthCheck baixa o CSV; se 200, cria `ConnectorAccount` e dispara `connector.ecommerce.backfill`.

---

## 4. Sincronização

- **Backfill**: lê **toda** a planilha. Filtra por range pedido.
- **Sync diário**: 02:30 UTC, re-importa últimos 7 dias (sobrescreve `EcommerceOrder` por `pedido` ID).

> Se o cliente altera dados antigos na planilha, o sync diário **não** corrige automaticamente — só os últimos 7 dias. Pra reprocessar, force re-sync manual via botão "Sincronizar".

---

## 5. Verificar dados

1. `/dashboard` → KPI **Faturamento** soma a planilha junto com outros conectores.
2. Query:
   ```sql
   SELECT date, COUNT(*) AS days, SUM(revenue) AS revenue
   FROM "EcommerceOrder"
   WHERE platform = 'GOOGLE_SHEETS' AND "workspaceId" = '<id>'
   GROUP BY date ORDER BY date DESC LIMIT 30;
   ```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=manual-credentials` (HTTP 401/403 no fetch) | Planilha não pública | Verificar "Qualquer pessoa com link" |
| 0 pedidos no backfill | Headers da planilha não batem | Renomear colunas pra `Dia` / `Qtd. Vendas` / `Valor em vendas` |
| Pedido com valor errado | Coluna `Valor em vendas` com texto livre antes do número | Mantenha apenas `R$ 1.234,56` |
| Sync diário não pega correções antigas | Janela de 7 dias | Forçar re-sync manual |
| Planilha tem várias abas | Conector lê só a aba do `gid` | Use `gid` correto da aba que vai integrar |

---

## Referências de código

- Parser CSV: [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) — `googleSheetsCsvUrl`, `parseCsvRows`, `extractDailyGoogleSheetPayloads`
- Normalização de moeda BR: `parseSheetMoney`
- Sync genérico: [src/lib/connectors/ecommerce-sync.ts](../../../src/lib/connectors/ecommerce-sync.ts)
