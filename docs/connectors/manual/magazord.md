# Magazord

> Categoria: **E-commerce** · Modo: **Manual (Basic Auth + X-Api-Token)** · Janela de backfill: **30 dias**

---

## O que esse conector traz pro dashboard

- Pedidos via Magazord API (`/pedidos`)
- Faturamento, ticket médio, produtos

Tabelas: `EcommerceOrder`, `EcommerceOrderItem`, `DailyMetric` (source=`MAGAZORD`).

---

## Antes de começar

- [ ] Acesso ao painel Magazord do cliente.
- [ ] **Usuário + senha** de API (Basic Auth) **E** um **API Token** (header `X-Api-Token`).

---

## 1. Setup no painel Magazord

1. Logue na admin da loja Magazord.
2. **Configurações → Integrações → API**.
3. Gere ou copie:
   - **Usuário API** + **Senha API** (Basic Auth)
   - **Token de Integração** (X-Api-Token)
4. **URL base da API**: pergunte ao suporte Magazord do cliente — varia por contrato. Formato típico: `https://api.{loja}.magazord.com.br`.

> Magazord exige **os dois métodos simultaneamente**: Basic Auth identifica o usuário, X-Api-Token autoriza a aplicação. Sem um deles, healthCheck falha.

---

## 2. Conectar a loja Magazord

`/connectors` → card Magazord → preencha:

| Campo | Valor | Obrigatório |
|---|---|---|
| Base URL | URL da API (ex: `https://api.loja.magazord.com.br`) | sim |
| Orders Path | `/pedidos` (default) | não |
| API User | Usuário Basic Auth | sim |
| API Password | Senha Basic Auth | sim |
| API Key | Token (vai em `X-Api-Token`) | sim |

Headers gerados ([src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) `buildHeaders` case MAGAZORD):
```
Authorization: Basic base64(apiUser:apiPassword)
X-Api-Token: <apiKey>
Accept: application/json
```

Clique **Conectar Magazord**. healthCheck testa `GET {baseUrl}/pedidos?limit=1`.

---

## 3. Sincronização

- **Backfill**: 30 dias.
- **Sync diário**: 02:30 UTC.
- Query: `GET /pedidos?created_at_min={since}&created_at_max={until}&limit=200`.

---

## 4. Verificar dados

```sql
SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue
FROM "EcommerceOrder"
WHERE platform = 'MAGAZORD' AND "workspaceId" = '<id>'
GROUP BY date ORDER BY date DESC;
```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=manual-credentials` | Faltou um dos dois (user/password ou token) | Preencher TODOS três campos: apiUser, apiPassword, apiKey |
| 401 Unauthorized | Credenciais ou token inválidos | Regenerar no painel |
| 404 no `/pedidos` | API base com path errado (deve terminar sem `/pedidos`) | Conferir Base URL — W3ADS apenda o path |

---

## Referências de código

- Auth Magazord: [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) — `buildHeaders` case MAGAZORD
- Default orders path: `providerOrdersPath` → `/pedidos`
