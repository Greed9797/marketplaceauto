# Nuvemshop / Tiendanube

> Categoria: **E-commerce** · Modo: **OAuth (Partner App)** · Suporta seleção: **sim** (uma store_id por conexão) · Janela de backfill: **30 dias**

---

## O que esse conector traz pro dashboard

- Pedidos (`EcommerceOrder`) com produtos e clientes
- Faturamento diário, ticket médio, produtos mais vendidos
- Estados (UF) baseados em endereço de entrega

Tabelas: `EcommerceOrder`, `EcommerceOrderItem`, `DailyMetric` (source=`NUVEMSHOP`).

---

## Antes de começar

- [ ] Master ou Gestor de Contas no W3ADS.
- [ ] Conta de Partner ativa em https://partners.nuvemshop.com.br (ou https://partners.tiendanube.com).
- [ ] Loja Nuvemshop do cliente que vai conectar.

---

## 1. Setup no Nuvemshop Partner

1. Acesse https://partners.nuvemshop.com.br → **Apps → Criar app**.
2. Tipo: **External app**.
3. Configure:
   - **Nome**: `W3ADS`
   - **Redirect URI**: `{NEXTAUTH_URL}/api/connectors/nuvemshop/callback`
   - **Permissões/scopes**: `read_orders`, `read_products`, `read_customers` (todos read-only)
4. Após criar, anote:
   - **Client ID** (a Nuvemshop chama de "App ID")
   - **Client Secret**
5. Marque o app como **disponível para instalação** quando estiver pronto para produção.

---

## 2. Configurar ProviderConfig

`/connectors/settings/nuvemshop`:

| Campo | Valor |
|---|---|
| Client ID | (do Partner) |
| Client Secret | (do Partner — vai pro vault) |
| Redirect URI | `{NEXTAUTH_URL}/api/connectors/nuvemshop/callback` |
| Base URL | `https://api.tiendanube.com/v1` (default em [src/lib/connectors/nuvemshop/oauth.ts](../../../src/lib/connectors/nuvemshop/oauth.ts)) |
| Status | `ACTIVE` |

**Validar** → **Salvar**.

---

## 3. Conectar uma loja

1. `/connectors` → card Nuvemshop → **Conectar Nuvemshop**.
2. Redirect pra `https://www.nuvemshop.com.br/apps/<app_id>/authorize`.
3. Dono da loja autoriza o app.
4. Callback `/api/connectors/nuvemshop/callback?code=...&state=...`:
   - Valida `state` cookie
   - POST pra `/v1/authorize/token` trocando code por access token (Bearer) + `user_id` (que é o `store_id`)
   - Cria ConnectorAccount com `externalAccountId = store_id`
5. Evento Inngest `connector.ecommerce.backfill` emitido.

---

## 4. Sincronização

- **Backfill**: 30 dias de pedidos (status APPROVED/PAID).
- **Sync diário**: 02:30 UTC, últimos 3 dias.
- **Webhook**: Nuvemshop suporta webhooks de `order/created`, `order/paid` — **não implementado** ainda no W3ADS (próxima feature).

`NuvemshopClient.listOrders` ([src/lib/connectors/nuvemshop/client.ts](../../../src/lib/connectors/nuvemshop/client.ts)) é chamado pelo orquestrador genérico de ecommerce em [src/lib/connectors/ecommerce-sync.ts](../../../src/lib/connectors/ecommerce-sync.ts).

---

## 5. Verificar dados

1. `/dashboard` → KPI **Faturamento** + **Pedidos**.
2. Query:
   ```sql
   SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue
   FROM "EcommerceOrder"
   WHERE platform = 'NUVEMSHOP' AND "workspaceId" = '<id>'
   GROUP BY date ORDER BY date DESC LIMIT 30;
   ```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=nuvemshop-api` | Acesso negado pela API (app inativo ou scope insuficiente) | Confirmar app marcado como production no Partner |
| `?error=invalid-state` | Cookie state expirou | Refazer fluxo |
| `?error=missing-provider-config` | Client ID/Secret não cadastrados | `/connectors/settings/nuvemshop` |
| Backfill traz 0 pedidos | Loja sem pedidos APPROVED nos últimos 30d | Verificar período mais longo manualmente |
| Token expirado | Nuvemshop tokens não expiram, mas podem ser revogados pelo dono da loja | Reconectar |

---

## Referências de código

- OAuth: [src/lib/connectors/nuvemshop/oauth.ts](../../../src/lib/connectors/nuvemshop/oauth.ts)
- Connect: [src/app/api/connectors/nuvemshop/connect/route.ts](../../../src/app/api/connectors/nuvemshop/connect/route.ts)
- Callback: [src/app/api/connectors/nuvemshop/callback/route.ts](../../../src/app/api/connectors/nuvemshop/callback/route.ts)
- Client: [src/lib/connectors/nuvemshop/client.ts](../../../src/lib/connectors/nuvemshop/client.ts)
- Sync genérico: [src/lib/connectors/ecommerce-sync.ts](../../../src/lib/connectors/ecommerce-sync.ts)
