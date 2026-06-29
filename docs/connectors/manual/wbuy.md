# WBuy

> Categoria: **E-commerce** · Modo: **Manual (Basic Auth ou x-token)** · Janela de backfill: **30 dias**

---

## O que esse conector traz pro dashboard

- Pedidos via API WBuy (`/order` endpoint)
- Faturamento, ticket médio, produtos

Tabelas: `EcommerceOrder`, `EcommerceOrderItem`, `DailyMetric` (source=`WBUY`).

---

## Antes de começar

- [ ] Credenciais WBuy (escolha um dos dois métodos):
  - **API user + password** (Basic Auth via Bearer)
  - **API token** (header `x-token`)

---

## 1. Setup no painel WBuy

1. Logue em https://sistema.sistemawbuy.com.br.
2. **Configurações → API → Integrações**.
3. Gere usuário/senha de API ou um token. Anote.
4. **Base URL padrão** já configurado no W3ADS: `https://sistema.sistemawbuy.com.br/api/v1`. Sobrescreva apenas se sua instância usa outro host.

---

## 2. Conectar a loja WBuy

Em `/connectors` → card WBuy → preencha:

| Campo | Valor | Obrigatório |
|---|---|---|
| Base URL | (deixe em branco pra usar default) ou URL customizada | não |
| Orders Path | `/order` (default) | não |
| API User | Usuário da API (se usar Basic Auth) | um dos dois |
| API Password | Senha da API | par |
| API Key | Token alternativo (header `x-token`) | um dos dois |

**Regras de auth** ([src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) `buildHeaders`):
1. Se `apiUser` + `apiPassword` preenchidos → `Authorization: Bearer base64(user:password)`.
2. Senão, se `apiKey` preenchido → `x-token: <apiKey>`.
3. Senão, healthCheck falha.

Clique **Conectar WBuy**. healthCheck testa `GET {baseUrl}/order?limit=1`.

---

## 3. Sincronização

- **Backfill**: 30 dias.
- **Sync diário**: 02:30 UTC.
- Endpoint: `GET /order?created_at_min={since}&created_at_max={until}&limit=200`.

---

## 4. Verificar dados

```sql
SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue
FROM "EcommerceOrder"
WHERE platform = 'WBUY' AND "workspaceId" = '<id>'
GROUP BY date ORDER BY date DESC;
```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=manual-credentials` | Auth falhou | Conferir user/password ou token; testar com curl manualmente |
| 401 | Usuário sem permissão "read orders" | Adicionar permissão no painel |
| Base URL não responde | Instância usa subdomínio diferente | Confirmar com cliente, preencher Base URL custom |

---

## Referências de código

- Auth handling WBuy: [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) — `buildHeaders` case WBUY
- Default base URL: constante `WBUY_API_BASE_URL`
