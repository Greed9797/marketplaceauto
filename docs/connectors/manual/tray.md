# Tray

> Categoria: **E-commerce** · Modo: **Manual (access_token query param)** · Janela de backfill: **30 dias**

---

## O que esse conector traz pro dashboard

- Pedidos da loja Tray via API REST
- Faturamento, ticket médio, produtos top

Tabelas: `EcommerceOrder`, `EcommerceOrderItem`, `DailyMetric` (source=`TRAY`).

---

## Antes de começar

- [ ] Acesso ao painel admin Tray do cliente.
- [ ] **Access token** da Tray API.

---

## 1. Setup no painel Tray

Tray usa fluxo OAuth próprio que termina com um **access_token** (`refresh_token` rotativo). Pra integrações simples:

1. Acesse https://www.tray.com.br/ajuda/api ou painel da loja.
2. **Aplicativos → Token de acesso** → gere um novo token.
3. Anote:
   - **Access token** (formato `XXXX...` ~50 chars)
   - **URL base da API** (ex: `https://{loja}.com.br/web_api`)

> A Tray hoje **não emite refresh automático** dentro do W3ADS; o usuário deve renovar o token periodicamente. Próxima feature: integrar refresh flow nativo da Tray.

---

## 2. Configurar ProviderConfig (opcional)

`/connectors/settings/tray` aceita defaults; geralmente desnecessário.

---

## 3. Conectar a loja Tray

Em `/connectors` → card Tray → preencha:

| Campo | Valor | Obrigatório |
|---|---|---|
| Base URL | URL completa da API da loja (ex: `https://loja.com.br/web_api`) | sim |
| Orders Path | `/orders` (default) | não |
| API Key | Access token (será enviado como query param `access_token`) | sim |

Clique **Conectar Tray**. healthCheck:
- GET `{baseUrl}/orders?limit=1&access_token=<key>`
- **Sem headers de Authorization** (Tray usa query param). Ver [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) `appendProviderQueryParams`.
- Se 200, cria `ConnectorAccount`.

---

## 4. Sincronização

- **Backfill**: 30 dias.
- **Sync diário**: 02:30 UTC, últimos 3 dias.

---

## 5. Verificar dados

```sql
SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue
FROM "EcommerceOrder"
WHERE platform = 'TRAY' AND "workspaceId" = '<id>'
GROUP BY date ORDER BY date DESC;
```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=manual-credentials` | Access token expirado ou inválido | Regenerar no painel Tray |
| 401 Unauthorized | Token revogado | Regenerar |
| Backfill traz 0 | Loja sem pedidos no período ou path errado | Confirmar `ordersPath` (default `/orders`) |

---

## Referências de código

- Auth via query param: [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) — função `appendProviderQueryParams`
- Rota manual: [src/app/api/connectors/manual/route.ts](../../../src/app/api/connectors/manual/route.ts)
