# iSet

> Categoria: **E-commerce** · Modo: **Manual (API key)** · Janela de backfill: **30 dias**

---

## O que esse conector traz pro dashboard

- Pedidos da loja iSet via API REST
- Faturamento, itens vendidos, ticket médio

Tabelas: `EcommerceOrder`, `EcommerceOrderItem`, `DailyMetric` (source=`ISET`).

---

## Antes de começar

- [ ] Master, Gestor de Contas, OWNER, ADMIN ou CLIENT do workspace.
- [ ] Acesso ao painel admin iSet do cliente.
- [ ] **API key de integração** gerada no painel (com permissão pra ler pedidos).

---

## 1. Setup no painel iSet

1. Logue no admin da loja (ex: `https://{loja}.iset.com.br/admin`).
2. **Configurações → Integrações → API**.
3. Gere uma **chave de integração**.
4. Anote:
   - **API Key** (formato variável; ~32 chars)
   - **URL base** da loja: `https://{loja}.iset.com.br` (sem `/ws/v1` — o W3ADS adiciona automaticamente)

---

## 2. Configurar ProviderConfig (opcional)

Pra iSet, `ProviderConfig` é opcional — usado apenas se quiser pré-cadastrar valores default no workspace. Acesse `/connectors/settings/iset` se quiser, ou pule direto pro passo 3.

---

## 3. Conectar a loja iSet

Em `/connectors` → seção manuais → card iSet → preencha:

| Campo | Valor | Obrigatório |
|---|---|---|
| Base URL | `https://{loja}.iset.com.br` | sim |
| Orders Path | `/pedidos` (default) | não |
| API Key | (do painel iSet) | sim |

> O `baseUrl` é normalizado em [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts) `appendIsetBasePath` — `/ws/v1` é apendado se não estiver presente.

Clique **Conectar iSet**. Backend chama `ManualCommerceClient.healthCheck()`:
- GET `{baseUrl}/ws/v1/pedidos?limit=1`
- Headers: `Authorization: Bearer <apiKey>` + `X-Integration-Key: <apiKey>`
- Se 200, cria `ConnectorAccount` e emite `connector.ecommerce.backfill`.

---

## 4. Sincronização

- **Backfill**: 30 dias.
- **Sync diário**: 02:30 UTC.
- Query padrão: `GET /ws/v1/pedidos?created_at_min=<since>&created_at_max=<until>&limit=200`.

---

## 5. Verificar dados

```sql
SELECT date, COUNT(*) AS orders, SUM(revenue) AS revenue
FROM "EcommerceOrder"
WHERE platform = 'ISET' AND "workspaceId" = '<id>'
GROUP BY date ORDER BY date DESC LIMIT 30;
```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=manual-credentials` | healthCheck falhou (401/403) | Verificar API key copiada inteira; checar permissão "read pedidos" no painel |
| `?error=invalid-manual-connector` | Base URL inválida | Use formato `https://loja.iset.com.br` |
| 0 pedidos no backfill | Loja sem vendas nos últimos 30d | Verificar manualmente no painel |
| Headers `X-Integration-Key` vs `Authorization` | iSet aceita os dois; usamos ambos | Nada — confiável |

---

## Referências de código

- Client + headers: [src/lib/connectors/manual-commerce-client.ts](../../../src/lib/connectors/manual-commerce-client.ts)
- Rota manual: [src/app/api/connectors/manual/route.ts](../../../src/app/api/connectors/manual/route.ts)
- Sync genérico: [src/lib/connectors/ecommerce-sync.ts](../../../src/lib/connectors/ecommerce-sync.ts)
