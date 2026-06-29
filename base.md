# W3-Marketplace — Plano de Construção & Stack Ponta a Ponta

> Documento de base do projeto **W3-Marketplace**. Combina o **frontend do W3ADS** (Next.js 15)
> com a **lógica de integração de marketplaces do w3saas** (Shopee, Mercado Livre), reorientando
> o produto de "tráfego pago genérico (Meta/Google)" para **performance de marketplace**
> (pedidos/receita + ads nativos do marketplace → ROAS). Serve tanto como **plano de execução**
> quanto como **registro permanente da stack** dos dois projetos de origem.

---

## 1. Contexto e objetivo

O usuário tem dois projetos e quer fundir **lógica + frontend** num produto novo:

- **w3saas** (`leonardoames/w3saas`) — SaaS de analytics e-commerce. Tem o **conhecimento de
  integração com marketplaces brasileiros/SEA**: Shopee, Shopee Ads, Mercado Livre, Olist/Tiny,
  além de Shopify/Nuvemshop. Mas é stack legada (Vite SPA + Supabase Edge Functions).
- **W3ADS** (`Greed9797/W3ADS`) — SaaS "W3 Ads" de performance: conecta plataformas de anúncio
  (Meta, Google Ads, GA4) para **gasto** e lojas (Shopify, Nuvemshop, WBuy…) para **receita**,
  calculando **ROAS**. Stack moderna (Next.js 15 + Prisma + Inngest) e — crucialmente — **já tem
  um registry de conectores abstraído** e modelos genéricos de marketplace.

**Objetivo:** criar **W3-Marketplace** = clone do W3ADS, **portando os conectores de marketplace
do w3saas** para o padrão do W3ADS, e **reorientando** o produto: as fontes de "anúncio" deixam de
ser Meta/Google e passam a ser os **ads nativos dos marketplaces** (Shopee Ads, Mercado Livre
Product Ads); as fontes de "receita" passam a ser os **pedidos dos marketplaces** (Shopee, Mercado
Livre). A arquitetura dual (gasto + receita → ROAS) é **mantida** — só mudam/expandem as fontes.

**Insight central:** o W3ADS já é a base ideal. A "lógica do w3saas" que de fato importa é o
*know-how de API* de cada marketplace (OAuth, assinatura, endpoints de pedidos, regras de
normalização de receita), não a arquitetura de edge functions — essa será **reimplementada** no
padrão Next.js do W3ADS.

---

## 2. Decisões aprovadas (do usuário)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Tráfego pago (Meta/Google/GA4) | **Manter lógica parecida** — pois haverá **ADS dos marketplaces** também. Não remover a arquitetura dual; reaproveitá-la para Shopee Ads / ML Ads. |
| 2 | Banco de dados | Usar o **"W3 Geral"** — o Supabase compartilhado da W3 (mesmo Postgres do W3ADS), em **schema próprio** do marketplace. |
| 3 | Marketplaces v1 | **Mercado Livre + Shopee** (pedidos) e, por causa da decisão #1, seus **Ads** (Shopee Ads + ML Product Ads). Olist/Tiny → fase 2. |
| 4 | Materialização | **Clonar W3ADS → `/Documents/GDRIVE/W3-Marketplace` como repo novo** (git/remote próprios, deploy próprio na Vercel). |

---

## 3. Produto resultante (visão)

**W3-Marketplace** = SaaS de performance de marketplace, multi-tenant (workspaces). O vendedor:
1. Conecta suas **lojas de marketplace** (Shopee, Mercado Livre, + Shopify/Nuvemshop/WBuy já
   existentes) → pedidos, receita, itens, estoque.
2. Conecta suas **contas de anúncio do marketplace** (Shopee Ads, Mercado Livre Product Ads) →
   gasto, impressões, cliques, campanhas.
3. Vê um **dashboard de ROAS de marketplace**: Receita, Pedidos, Top Produtos, Estoque, Gasto em
   ads e ROAS — tudo escopado por marketplace em vez de Meta/Google.

A pivotagem "deixar de ser tráfego pago → marketplace" se materializa trocando as *fontes* de ads
(Meta/Google → Shopee Ads/ML Ads) e adicionando as *fontes* de pedidos (Shopee/ML), sem
reescrever a engine de agregação/ROAS.

---

## 4. STACK PONTA A PONTA — W3ADS (base / frontend) — `~/code/W3ADS` @ `feat/connectors-expanded`

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Framework | Next.js App Router | 15.2.0 |
| UI runtime | React + React DOM | 19.0.0 |
| Linguagem | TypeScript (strict) | 5.8 |
| Styling | Tailwind CSS v4 + CSS variables (sem shadcn) | 4.0 |
| UI primitives | Radix UI + Lucide icons | — |
| Forms | React Hook Form + Zod | 7.53 / 3.25 |
| Charts | Recharts | 2.13 |
| ORM/DB | Prisma 5 + PostgreSQL (Supabase, schema `w3ads`) | 5.22 |
| Auth | NextAuth v5 (beta) + Prisma Adapter | 5.0.0-beta |
| Job queue | Inngest (serverless) | 4.4 |
| Rate limit | Upstash Redis + @upstash/ratelimit | — |
| Secrets | Supabase Vault (KMS) + fallback AES-GCM | — |
| Email | Resend | — |
| Observabilidade | Sentry + PostHog | — |
| Testes | Vitest + Playwright | — |
| Deploy | Vercel (região `gru1`), cron `0 6 * * *` → `/api/cron/workspace-sync` | — |

**Estrutura `src/` (resumo):**
```
src/
  app/
    (app)/dashboard|dashboards|connectors|profile|workspace|platform|feedback
    (auth)/login|sign-up|forgot-password|reset-password
    api/connectors/{provider}/connect|callback · manual · select · [id]/sync
    api/auth/[...nextauth] · api/cron/workspace-sync · api/webhooks/{shopify,nuvemshop}
  components/connectors · dashboards · layouts · ui · theme
  lib/connectors (registry, provider-config, credentials, ecommerce-sync, manual-commerce,
                  oauth-state, backfill, + meta/ google-ads/ shopify/ nuvemshop/)
  lib/metrics (period, aggregator, kpi-catalog, order-status)
  lib/jobs (inngest-client, functions/)
  lib/auth · lib/db/prisma · lib/security/secret-store · lib/utils/format-br
```

**Conectores existentes (registry):** categorias `ads | analytics | commerce`, modos `oauth | manual`.
- ads: **META_ADS**, **GOOGLE_ADS** · analytics: **GA4**
- commerce oauth: **SHOPIFY**, **NUVEMSHOP** · commerce manual: **ISET**, **TRAY**, **WBUY**, **MAGAZORD**, **GOOGLE_SHEETS**, **LOJA_INTEGRADA**

**Fatos load-bearing confirmados no código (file:line):**
- `DailyMetric.source` é o próprio enum `ConnectorProvider` (`prisma/schema.prisma:278`) — **não há
  enum `MetricSource` separado**. Nova fonte de ads = novo valor de enum + listar em
  `dashboardTrafficProviders`. **Sem mudança de schema em `DailyMetric`.**
- Sync de pedidos é **genérico**: todo commerce provider normaliza para a forma canônica
  `ShopifyOrder` (`src/lib/connectors/shopify/client.ts:113-134`); o rollup diário de receita é
  derivado de `EcommerceOrder` (`mapEcommerceOrdersToDailyMetricSummaries`, `ecommerce-sync.ts:78`).
  Novo provider de pedidos reusa `syncEcommerceOrders` 100% — só adiciona um client + um branch em
  `loadOrdersForConnector` (`ecommerce-sync.ts:397`).
- Filtro de "pago" centralizado em `isApprovedOrderStatus` (`src/lib/metrics/order-status.ts`) — **superfície
  crítica de compatibilidade** (Shopee usa estados de fulfillment).
- DB já roda em schema dedicado via `?schema=w3ads` no `DATABASE_URL` (`.env.example:5-7`), não via
  Prisma `multiSchema`.
- Agregador (`aggregator.ts`) calcula `revenue` de `EcommerceOrder` filtrado por `commerceProviders`
  (~`:526,541`) e `spend` de `DailyMetric` filtrado por `trafficProviders` (~`:553`),
  `roas = calculateRoas(revenue, spend)` (~`:581,249`). Lê as listas de `period.ts` → trocar
  providers lá basta para reorientar o dashboard.

---

## 5. STACK PONTA A PONTA — w3saas (fonte da lógica) — `~/w3saas` @ `feat-crm-role-filter`

| Camada | Tecnologia |
|--------|-----------|
| Framework | Vite 5 SPA + React 18 + React Router |
| Styling | Tailwind 3 + shadcn/ui |
| Data | TanStack Query 5 |
| Backend | Supabase Edge Functions (Deno) |
| DB/Auth | Supabase PostgreSQL + Supabase Auth (JWT) |

**Tabelas de integração:**
- `user_integrations` (legacy, `credentials` JSONB) — Shopee, Mercado Livre, Olist/Tiny…
- `marketplace_integrations` (novo, colunas explícitas: `access_token`, `refresh_token`,
  `token_expires_at`, `shop_url`, `status`, `external_account_id`…) — Shopify, Nuvemshop, Shopee,
  Shopee Ads, Mercado Livre.
- `marketplace_integration_users` (N:N multi-tenant, papel `admin_marketplace`).
- `sync_runs` (auditoria). Dados sincronizados caem em `metrics_diarias`
  (`vendas_quantidade`, `vendas_valor`, `faturamento`, `investimento_trafego`).

**16 Edge Functions:** 6 OAuth (`shopify/nuvemshop/shopee/shopee-ads/mercado-livre/google-calendar-oauth`)
+ 6 sync (`sync-shopify/-nuvemshop/-shopee/-shopee-ads/-mercado_livre/-olist_tiny`)
+ 2 webhooks (`nuvemshop-webhooks`, `shopify-webhooks`, HMAC) + orquestrador `sync-all-integrations`
(pg_cron 2h) + `oauth-config`. Shared: **`_shared/oauth-state.ts`** (state assinado HMAC-SHA256,
anti-CSRF, TTL 15min) e **`_shared/order-rules.ts`** (normaliza pedido de cada provider).

**Arquivos-fonte a portar (referência de lógica, NÃO copiar arquitetura):**
`supabase/functions/{mercado-livre-oauth,sync-mercado_livre,shopee-oauth,sync-shopee,shopee-ads-oauth,sync-shopee-ads}/index.ts`
e `_shared/order-rules.ts` (`normalizeMeliOrder:157`, `normalizeShopeeOrder:108`).

---

## 6. Arquitetura de conectores — comparação

| Aspecto | w3saas | W3ADS (base) |
|---|---|---|
| Abstração | Metadata-driven (`platforms[]` + `oauthFnMap`), parcial | Registry formal (`ConnectorProvider` enum + `CONNECTOR_PROVIDER_DEFINITIONS` + grupos) |
| OAuth state | HMAC-SHA256 (`_shared/oauth-state.ts`) | Assinado com `AUTH_SECRET` (`src/lib/connectors/oauth-state.ts`) |
| Backend | Edge Function por provider | API route Next.js + job Inngest |
| Sync | Função por provider em `metrics_diarias` | Genérico (`syncEcommerceOrders`) + por-provider (ads) |
| Secrets | JSONB/colunas | Supabase Vault + AES-GCM (`secretRefs`) |
| Multi-tenant | `marketplace_integration_users` | `Workspace`/`Membership` (RBAC) |

**Cobertura — o que falta no W3ADS e existe no w3saas (= o que portar):**
Shopee (pedidos), **Shopee Ads** (gasto), Mercado Livre (pedidos), **Mercado Livre Product Ads**
(gasto — confirmado existente no w3saas `sync-mercado_livre`), Olist/Tiny (fase 2).

---

## 7. Modelo de dados — como ADS + Marketplace coexistem (Prisma, W3ADS)

- **Pedidos/receita** → `EcommerceOrder` + `EcommerceOrderItem` + `ProductInventory` (genéricos por
  provider). Rollup diário em `DailyMetric` derivado dos pedidos.
- **Gasto/ads** → `DailyMetric` (`source`, `spend`, `impressions`, `clicks`, `conversions`,
  `campaignId/campaignName`, `dedupeHash @unique`).
- **ROAS** = receita (`EcommerceOrder` via `commerceProviders`) ÷ gasto (`DailyMetric` via
  `trafficProviders`). **Regra de ouro:** ads NÃO escrevem `revenue` (não inflar ROAS) — receita só
  vem de pedidos. (w3saas já segue isso: "Ads NÃO geram faturamento próprio".)

Conclusão: adicionar Shopee Ads/ML Ads = **adicionar valor de enum + listar em
`dashboardTrafficProviders`**, sem nova tabela.

---

## 8. Estratégia de banco — "W3 Geral"

**Recomendado:** novo schema **`w3marketplace`** no **mesmo Postgres/Supabase do W3ADS** ("W3 Geral"),
via `?schema=w3marketplace` em `DATABASE_URL` + `DIRECT_URL`, com histórico `prisma migrate` próprio.
Espelha o padrão atual (o `.env.example:5` já avisa que o projeto compartilhado usa `?schema=w3ads`
para evitar colisão com `public/pulmao/saas`).

> ⚠️ Confirmar no `~/code/W3ADS/.env` o project ref real do "W3 Geral" antes de configurar
> (exploração indicou `tuzoczzohirqddrcpbtc` para o W3ADS; o w3saas client.ts referencia
> `jmbouivvkofocqaakenb`). O schema novo isola dados/migrations dos dois produtos no mesmo projeto.

**Mudanças de config:** datasource do Prisma fica igual (`env("DATABASE_URL")`); só muda o `?schema=`.
Nova baseline `prisma migrate` cria `_prisma_migrations` dentro do schema novo (sem colisão). Vault:
secrets já são chaveados por workspace/provider/account (`credentials.ts:159`), coexistem no Vault
compartilhado desde que os **workspace ids sejam distintos**.

| Opção | Risco |
|---|---|
| **Schema novo `w3marketplace`** (recomendado) | Setup extra (bootstrap migration, env). Pool de conexão compartilhado com w3ads. |
| Reusar schema `w3ads` | Migrations dos dois produtos colidem; `prisma migrate` de um pode clobberar o `_prisma_migrations` do outro; RLS e dados misturados. **Alto risco — evitar.** |

---

## 9. Receita genérica — "adicionar um conector de marketplace ao W3ADS"

Dois trilhos: **commerce/pedidos** (reusa o pipeline genérico) e **ads/gasto** (precisa de writer de `DailyMetric`).

**A. Schema** — `prisma/schema.prisma:249-262`: adicionar ao enum `ConnectorProvider`:
`MERCADO_LIVRE`, `SHOPEE`, `SHOPEE_ADS`, `MERCADO_LIVRE_ADS`. **Append-only** (nunca reordenar/remover
— enum Postgres é posicional). Depois `prisma migrate dev`.

**B. Registry** — `src/lib/connectors/registry.ts:17-130`: uma `ConnectorProviderDefinition` por provider
(commerce: `category:"commerce"`, `connectionMode:"oauth"`, `supportsOrders:true`; ads:
`category:"ads"`, `supportsAdMetrics:true`). Adicionar ao grupo certo em `:132-151`
(`oauthCommerceProviders` p/ ML+Shopee; estender `selectableAdsProviders`/novo `oauthAdsProviders` p/
Shopee Ads+ML Ads). `isOAuthCommerceProvider` passa a incluí-los no sync genérico automaticamente.
> Cuidado: `getConnectorDefinition` lança se um valor de enum não tiver definição no registry — toda
> entrada nova do enum precisa de definição.

**C. Provider config** — `src/lib/connectors/provider-config.ts`: branch em `validateProviderConfigInput`
(~`:262-387`) + helper `buildXConfigFromProviderConfig` (espelhar
`buildNuvemshopConfigFromProviderConfig` ~`:630`). Creds públicas → `publicCredentials`; secrets
(`partner_key`, `client_secret`) → `secretRefs` (Vault).

**D. Rotas OAuth** — clonar de `nuvemshop`:
- `src/app/api/connectors/<provider>/connect/route.ts`: `getCurrentUserContext` →
  `canOperateWorkspaceConnectors` → `getActiveProviderConfig` → `createConnectorOAuthState` → URL
  authorize → redirect. (Shopee: URL precisa de assinatura HMAC — §10.)
- `src/app/api/connectors/<provider>/callback/route.ts`: verifica state → troca `code` por tokens →
  cria `ConnectorAccount` (single account) ou `createConnectorSelectionSession` (multi). Tokens via
  Vault (`vaultCredentialFields`, `credentials.ts:159`).

**E. Selection session** — ML e Shopee são single-account → `supportsSelection:false`, cria
`ConnectorAccount` direto no callback. Pular `/api/connectors/select`.

**F. Sync:**
- Commerce: `src/lib/connectors/<provider>/client.ts` com `listOrders(): ShopifyOrder[]` + branch em
  `loadOrdersForConnector` (`ecommerce-sync.ts:397`). Resto reusado.
- Ads: `src/lib/connectors/<provider>/sync.ts` que faz upsert de `DailyMetric` por `dedupeHash`
  (espelhar `meta/sync.ts`); `source` = enum de ads; popular `spend/impressions/clicks` +
  `campaignId/campaignName`.

**G. Jobs (cron + Inngest):**
- `src/lib/connectors/backfill.ts`: commerce → case `connector.ecommerce.backfill` em
  `eventNameForProvider` (~`:83-90`); ads → novo evento na union `ConnectorBackfillEventName`
  (~`:8-13`), ex. `connector.marketplace_ads.backfill`.
- `src/lib/jobs/functions/`: novo `sync-marketplace-ads.ts` (Inngest) + **registrar em
  `index.ts:8`** (`inngestFunctions`). Commerce não precisa de função nova (usa `syncEcommerceBackfill`).
- Cron diário (`sync-daily.ts` + `isSyncableProvider` + `vercel.json` `0 6 * * *`) inclui o provider
  uma vez mapeado em `eventNameForProvider` e marcado syncable.

**H. UI:**
- `src/app/(app)/connectors/page.tsx`: card por provider (clonar bloco Nuvemshop/Shopify ~`:328-376`).
- `src/lib/metrics/period.ts:36-77`: commerce → `dashboardCommerceProviders` + labels; ads →
  `dashboardTrafficProviders` + labels. **É o que faz o dashboard captar as novas fontes.**

---

## 10. Ports específicos

### Mercado Livre (OAuth, pedidos) — exemplo trabalhado
Fonte: `mercado-livre-oauth` + `sync-mercado_livre` + `order-rules.normalizeMeliOrder:157`.
- Authorize: `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id&redirect_uri` + `state`.
- Token: `POST https://api.mercadolibre.com/oauth/token` (form-urlencoded; `grant_type=authorization_code|refresh_token`). Token expira ~6h → **refresh obrigatório** no caminho de access-token.
- `externalAccountId = tokens.user_id`.
- Pedidos: `GET /orders/search?seller={id}&order.date_created.from={ISO}&sort=date_desc&limit=50&offset` (Bearer). Paginar por offset; throttle ~1.1s/página. `order_items` já vêm na busca (sem fetch de detalhe).
- Mapa → `ShopifyOrder`: `externalOrderId=order.id`; `orderTotal=total_amount` (**não** somar `payments`); `placedAt=date_created`; `status` → normalizar (`refunded` se algum payment em estados ruins, senão `paid`); `items` de `order_items` (`title`, `quantity`, `unit_price*qty`, `seller_sku`).
- Reuso: 100% de `ecommerce-sync.ts`. Net-new: `mercado-livre/{oauth,client}.ts` + rotas + config + registry/period.

### Shopee (OAuth, pedidos)
Fonte: `shopee-oauth` + `sync-shopee` + `normalizeShopeeOrder:108`.
- **Assinatura HMAC (detalhe crítico):** `HMAC-SHA256(partner_key, baseString)` hex.
  - Endpoints públicos (auth, token get/refresh): `baseString = partner_id + api_path + timestamp`.
  - Endpoints de shop (orders, ads): `baseString = partner_id + api_path + timestamp + access_token + shop_id`.
  - Query sempre com `partner_id, timestamp, sign` (+ `access_token, shop_id` p/ shop). `timestamp`=unix segundos; **clock skew quebra a assinatura**.
- Auth: `/api/v2/shop/auth_partner` (redirect), `/api/v2/auth/token/get`, `/api/v2/auth/access_token/get` (refresh). `externalAccountId = shop_id`.
- Pedidos: `/api/v2/order/get_order_list` (`time_range_field=create_time`, `page_size=100`, `cursor`/`next_cursor`) → `/api/v2/order/get_order_detail` em lotes ≤50 (`response_optional_fields=total_amount,buyer_total_amount,escrow_amount,create_time,pay_time,order_status,item_list`).
- Mapa → `ShopifyOrder`: `orderTotal=buyer_total_amount||total_amount||escrow_amount`; `placedAt=create_time`; items de `item_list`.
- **MISMATCH de status pago (crítico):** estados pagos da Shopee (`READY_TO_SHIP, PROCESSED, RETRY_SHIP, SHIPPED, TO_CONFIRM_RECEIVE, COMPLETED`) são rejeitados pelo `isApprovedOrderStatus` genérico (que descarta fulfillment). **Solução:** normalizar no client emitindo `"paid"` para a allowlist Shopee (padrão iSET/WBuy), OU adicionar `SHOPEE_PAID_FULFILLMENT_TERMS` em `order-status.ts` (como o bloco `WBUY_PAID_FULFILLMENT_TERMS` existente ~`:58`).

### Shopee Ads (gasto → DailyMetric)
Fonte: `sync-shopee-ads`. Endpoint `/api/v2/ads/get_all_cpc_ads_daily_performance` (shop-signed):
`expense/cost`, `clicks`, `impression`, `broad_gmv`, `broad_order`.
- `source=SHOPEE_ADS`, `spend=expense||cost`, `clicks`, `impressions=impression`, `date`, `dedupeHash`.
- **NÃO** escrever `broad_gmv` em `revenue`. Adicionar `SHOPEE_ADS` a `dashboardTrafficProviders`.

### Mercado Livre Product Ads (gasto) — **já existe no w3saas (só port TS)**
Fonte: `sync-mercado_livre/index.ts:280-339`. `GET /advertising/advertisers?product_id=PADS`
(header `Api-Version:1`) → advertisers; depois `GET /advertising/advertisers/{id}/product_ads/campaigns?date_from&date_to&metrics=clicks,prints,cost&aggregation_type=DAILY`
(header `api-version:2`, chunks de 30 dias). Mapa: `cost→spend`, `prints→impressions`, `clicks→clicks`,
`source=MERCADO_LIVRE_ADS` (+ campaign-level dá `campaignId/campaignName`).

---

## 11. Reorientação do dashboard (marketplace-first, mantendo ROAS)

O dashboard é agnóstico à fonte; o acoplamento a Meta/Google está em **2 arrays + labels**. **Relabel, não refatorar:**
- `src/lib/metrics/period.ts:36-77`: `dashboardTrafficProviders = [SHOPEE_ADS, MERCADO_LIVRE_ADS]`
  (+ labels "Shopee Ads"/"Mercado Livre Ads"); `dashboardCommerceProviders = [SHOPEE, MERCADO_LIVRE, …existentes]`.
- `src/lib/metrics/aggregator.ts`: **sem mudança de lógica** (lê os arrays acima).
- `src/components/dashboards/operational-tables.tsx`: tabela "Campanhas" funciona se os ads syncs
  emitirem `campaignId/campaignName`; só relabel de header e mapas `campaignObjectiveLabels:55` /
  `campaignStatusLabels:37` para vocabulário de marketplace.
- `src/app/(app)/connectors/page.tsx`: reagrupar seções → "Marketplaces" + "Marketplace Ads" no lugar
  de "Mídia Paga"/"E-commerce" (mudança de cópia/agrupamento).

> Sobre a decisão #1: **mantemos** Meta/Google/GA4 no código (lógica preservada), mas o dashboard do
> W3-Marketplace lidera com as fontes de marketplace. Religar Meta/Google é só adicioná-los de volta
> aos arrays de `period.ts` — reversível.

---

## 12. Plano faseado

- **Fase 0 — Infra & materialização:** clonar `~/code/W3ADS` → `~/Documents/GDRIVE/W3-Marketplace`
  (repo novo, git limpo, remote novo); novo schema `w3marketplace` no Postgres "W3 Geral";
  `DATABASE_URL/DIRECT_URL/SUPABASE_*/AUTH_SECRET/INNGEST_*/UPSTASH_*/CRON_SECRET` novos; baseline
  `prisma migrate`. **Boot limpo** + login funcionando.
- **Fase 1 — Scaffolding enum + registry + period:** 4 valores de enum, definições/grupos no registry,
  validação/build em `provider-config`, arrays/labels em `period.ts`. Migrate. App ainda builda.
- **Fase 2 — Mercado Livre (pedidos):** oauth+client, connect/callback, branch em `loadOrdersForConnector`,
  normalização de refund, card de conector. Validar ROAS end-to-end com 1 seller.
- **Fase 3 — Shopee (pedidos):** util de assinatura HMAC (2 esquemas), oauth+client, order list+detail,
  decisão de status pago, connect/callback, branch de sync. Validar.
- **Fase 4 — Marketplace Ads (gasto):** ML Product Ads + Shopee Ads → `DailyMetric`; novo evento
  `connector.marketplace_ads.backfill` + função Inngest + registro em `index.ts`; mapear em
  `eventNameForProvider`. Validar gasto + ROAS.
- **Fase 5 — Reorientação do dashboard:** relabel period/labels, agrupamento da página de conectores,
  cópia da tabela Campanhas. `visual-check`.
- **Fase 6 — Hardening:** refresh de token (401), paginação deadline-bounded (padrão Nuvemshop
  `ecommerce-sync.ts:418-535`), review de `dedupeHash`, Vault, `CRON_SECRET`, dedup de id Inngest.
  Revisão cross-provider (Codex adversarial em auth/HMAC/migrations, conforme regras de orquestração).

**Arquivos críticos (editar):**
`prisma/schema.prisma` · `src/lib/connectors/registry.ts` · `src/lib/connectors/provider-config.ts` ·
`src/lib/connectors/ecommerce-sync.ts` (:397) · `src/lib/connectors/backfill.ts` ·
`src/lib/jobs/functions/index.ts` · `src/lib/metrics/period.ts` · `src/app/(app)/connectors/page.tsx` ·
`src/components/dashboards/operational-tables.tsx`
**Arquivos novos:** `src/lib/connectors/{mercado-livre,shopee,shopee-ads,mercado-livre-ads}/*` ·
`src/app/api/connectors/{mercado-livre,shopee,shopee-ads,mercado-livre-ads}/{connect,callback}/route.ts` ·
`src/lib/jobs/functions/sync-marketplace-ads.ts` · util HMAC Shopee.

---

## 13. Riscos & armadilhas (do blueprint validado)

1. **Enum append-only** — adicionar valores é seguro; reordenar/remover é destrutivo no Postgres. Todo valor novo precisa de definição no registry (`getConnectorDefinition` lança senão).
2. **Status pago Shopee** — `isApprovedOrderStatus` rejeita fulfillment; sem normalização, GMV pago fica subcontado. Decidir client-side `"paid"` OU allowlist Shopee em `order-status.ts`.
3. **Refund/chargeback ML** — `order_status` pode ficar `"paid"` com payment estornado; checar `payments[]` no client e emitir `"refunded"`, senão receita infla.
4. **`dedupeHash` único** — ads writers devem incluir `source + campaignId + date` para não colidir com rollups de ecommerce nem entre campanhas (hash ruim sobrescreve silenciosamente).
5. **Rate limits** — Shopee (~req/s, throttle + lotes de 50) e ML (~1.1s/página). Reusar padrão deadline-bounded por página (Nuvemshop `ecommerce-sync.ts:418-535`); "puxar tudo na memória" estoura timeout da função Vercel.
6. **Secrets/Vault** — `partner_key`/`client_secret` só no Vault (`secretRefs` + sentinela `"vault"`, `credentials.ts:79-185`); tratar `CredentialUnavailableError` no redirect amigável.
7. **Refresh de token no 401** — ML (curto) e Shopee precisam de refresh no caminho de access-token, senão cron silenciosamente falha após expiry (`status → TOKEN_EXPIRED`).
8. **Webhooks fora de escopo MVP** — manter modelo de backfill diário + incremental; só LGPD/uninstall webhooks existem.
9. **Registro Inngest** — esquecer de adicionar a função nova em `inngestFunctions` (`index.ts:8`) → evento emitido mas nunca tratado (no-op silencioso); id duplicado quebra o registro.
10. **Cron** — schedule real é `0 6 * * *` (06:00 UTC) em `vercel.json`; confirmar `CRON_SECRET` no novo projeto Vercel.

---

## 14. Verificação end-to-end

- **Build/lint:** `npm run build` + `tsc --noEmit` + `npm run lint` no W3-Marketplace (sem erros). Validar que o app dá boot e o login NextAuth funciona contra o DB novo.
- **DB:** `prisma migrate status` limpo no schema `w3marketplace`; enum `ConnectorProvider` com os 4 valores novos.
- **Mercado Livre (Fase 2):** conectar 1 seller real (sandbox/produção) → disparar backfill →
  conferir linhas em `EcommerceOrder`/`EcommerceOrderItem` e rollup em `DailyMetric`; ROAS aparece no dashboard.
- **Shopee (Fase 3):** conectar 1 shop → validar assinatura HMAC (sem erro de `sign`/`timestamp`) →
  pedidos com status pago corretamente contados (testar a decisão de normalização).
- **Ads (Fase 4):** backfill Shopee Ads + ML Ads → `DailyMetric.spend` populado, `revenue` NÃO inflado,
  ROAS = receita/gasto coerente.
- **Dashboard (Fase 5):** `visual-check <url>` desktop + mobile — cards de marketplace, sem labels
  "Mídia Paga"/Meta/Google; tabela Campanhas com vocabulário de marketplace.
- **Testes:** rodar `npx vitest run` (suite existente) + adicionar testes unitários dos normalizadores
  (ML/Shopee → `ShopifyOrder`) e do signer HMAC Shopee (vetor conhecido).
- **Review:** `/codex:adversarial-review` em auth/HMAC/migrations antes de merge (regra de orquestração).

---

## 15. Pendências a confirmar na execução

1. **Project ref do "W3 Geral"** — ler `~/code/W3ADS/.env` para confirmar o Supabase real e validar
   que o schema `w3marketplace` pode ser criado nele.
2. **Credenciais de app** dos marketplaces (a obter no painel de cada plataforma):
   `ML_CLIENT_ID/ML_CLIENT_SECRET/ML_REDIRECT_URI`, `SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY`
   (+ `SHOPEE_ADS_*` se app separado). Sem isso, OAuth não conecta em produção.
3. **Manter ou esconder Meta/Google/GA4** na UI v1 — decisão #1 = manter lógica; default: presentes no
   código, fora do destaque do dashboard. Confirmar se aparecem na página de conectores ou ficam ocultos.
4. **Remote/repo novo + projeto Vercel** para o W3-Marketplace (nome, domínio).
