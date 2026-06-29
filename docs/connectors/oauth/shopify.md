# Shopify

> Categoria: **E-commerce** · Modo: **OAuth (Custom App)** · Suporta seleção: **não** (uma loja por conexão) · Janela de backfill: **60 ou 90 dias**

---

## O que esse conector traz pro dashboard

- Pedidos (`EcommerceOrder`) e itens (`EcommerceOrderItem`)
- Faturamento (`revenue`) e quantidade (`orders`) na agregação diária
- Produtos mais vendidos, estados (UF) com mais vendas, ticket médio
- Webhook em tempo real (orders/create) — pedido entra no dashboard em segundos

Tabelas: `EcommerceOrder`, `EcommerceOrderItem`, `DailyMetric` (source=`SHOPIFY`).

---

## Antes de começar

- [ ] Master ou Gestor de Contas no W3ADS.
- [ ] Plano Shopify que permita Custom Apps (Basic ou superior).
- [ ] Você precisa do **app** Shopify (Custom App da loja **ou** Public App do Partner Dashboard).

---

## 1. Setup no Shopify

### Opção A — Custom App da loja (mais simples, se cliente só tem uma loja)

1. Logue em https://`{loja}`.myshopify.com/admin.
2. **Settings → Apps and sales channels → Develop apps**.
3. **Allow custom app development** (admin only) → confirme.
4. **Create an app** → nome: `W3ADS`.
5. **Configuration → Admin API access scopes**, marque:
   - `read_orders`
   - `read_products`
   - `read_customers`
   - `read_analytics`
6. **API credentials**:
   - Copie **API key** e **API secret key**.
7. Como é Custom App, **não usa OAuth flow**. Em vez disso, use o **Admin API access token** direto — formato `shpat_xxxxxxxx`. Mas o W3ADS usa o **OAuth flow** padrão pra apps publicáveis. Pra Custom App, prefira a Opção B.

### Opção B — Public App via Partner Dashboard (recomendado pra agência)

1. Acesse https://partners.shopify.com → **Apps → Create app** (manual).
2. Nome: `W3ADS`. Tipo: **Public** ou **Custom Distribution**.
3. Em **App setup**:
   - **App URL**: `{NEXTAUTH_URL}`
   - **Allowed redirection URL(s)**:
     ```
     {NEXTAUTH_URL}/api/connectors/shopify/callback
     ```
4. **API credentials**:
   - **Client ID** (= `apiKey`)
   - **Client secret** (= `apiSecret`)
5. Em **App Setup → Compliance webhooks**, deixe URLs do W3ADS (opcionais por enquanto).

---

## 2. Configurar ProviderConfig

`/connectors/settings/shopify`:

| Campo | Valor |
|---|---|
| API Key | Client ID do app |
| API Secret | Client Secret do app (vai pro vault) |
| API Version | `2026-04` (default, ver [src/lib/connectors/shopify/oauth.ts](../../../src/lib/connectors/shopify/oauth.ts)) |
| Scopes | `read_orders,read_products,read_customers,read_analytics` (default) |
| Status | `ACTIVE` |

> **Atenção scope `read_all_orders`**: pra ler pedidos com mais de 60 dias, Shopify exige escopo extra `read_all_orders`. Sem ele, o backfill cobre 60d; com ele, 90d. Veja [src/lib/connectors/backfill.ts](../../../src/lib/connectors/backfill.ts).

**Validar** → **Salvar**.

---

## 3. Conectar uma loja

1. `/connectors` → card Shopify → preencha **Loja** (`loja.myshopify.com`) → **Conectar Shopify**.
2. Redirect pra `https://{shop}/admin/oauth/authorize?...`.
3. Admin da loja autoriza scopes.
4. Callback `/api/connectors/shopify/callback` valida HMAC, troca code por `access_token` (formato `shpat_xxx`) e grava `ConnectorAccount`.
5. Evento Inngest `connector.shopify.backfill` emitido.

Pra desconectar: botão "Remover" no card (Master/Gestor Contas only).

---

## 4. Sincronização

- **Backfill**: 60d (default) ou 90d (com `read_all_orders`).
- **Sync incremental diário**: 02:00 UTC, pega últimos 3 dias.
- **Webhook real-time**: `orders/create` registra na URL `{NEXTAUTH_URL}/api/webhooks/shopify`. HMAC validado server-side.

---

## 5. Verificar dados

1. `/dashboard?period=week` → KPI **Faturamento** + tabela **Produtos**.
2. Total de vendas por UF aparece na seção **Total de vendas por Estado**.
3. Query:
   ```sql
   SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue
   FROM "EcommerceOrder"
   WHERE platform = 'SHOPIFY' AND "workspaceId" = '<id>'
     AND date >= NOW() - INTERVAL '30 days'
   GROUP BY date
   ORDER BY date DESC;
   ```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=invalid-shop` | Domínio mal formatado (precisa ser `loja.myshopify.com`) | Use domínio `.myshopify.com`, não o domínio custom |
| `?error=invalid-hmac` | Assinatura HMAC do callback não confere | Verificar se `apiSecret` no W3ADS bate com o do Partner Dashboard |
| `?error=missing-shop` | Form submetido sem domínio | Preencher campo "Loja" |
| `?error=shopify-api` | Acesso negado pela loja (escopo recusado / app não instalável) | Verificar plano Shopify e scopes |
| Backfill cobre só 60d | Falta scope `read_all_orders` | Adicionar scope e reconectar |
| Webhook não chega | URL pública não acessível ou HMAC errado | Verificar `NEXTAUTH_URL` em prod, e que `/api/webhooks/shopify` está acessível externamente |

---

## Referências de código

- OAuth URL: [src/lib/connectors/shopify/oauth.ts](../../../src/lib/connectors/shopify/oauth.ts)
- Connect: [src/app/api/connectors/shopify/connect/route.ts](../../../src/app/api/connectors/shopify/connect/route.ts)
- Callback: [src/app/api/connectors/shopify/callback/route.ts](../../../src/app/api/connectors/shopify/callback/route.ts)
- Webhook handler: [src/app/api/webhooks/shopify/route.ts](../../../src/app/api/webhooks/shopify/route.ts)
- Client: [src/lib/connectors/shopify/client.ts](../../../src/lib/connectors/shopify/client.ts)
- Sync: [src/lib/connectors/shopify/sync.ts](../../../src/lib/connectors/shopify/sync.ts)
- Backfill windows: [src/lib/connectors/backfill.ts](../../../src/lib/connectors/backfill.ts)
