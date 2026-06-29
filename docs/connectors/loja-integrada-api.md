# Loja Integrada — Referência da API (para o connector W3ADS)

> Fonte: docs oficiais (api-docs.lojaintegrada.com.br), Apiary legado
> (lojaintegrada.docs.apiary.io), linkapi.solutions. Capturado 2026-06-15.

## Autenticação

- **Base URL:** `https://api.awsli.com.br/v1`
- **Duas credenciais por conexão:**
  - `chave_api` — identifica a **loja** (credencial única de 20 chars, gerada
    no painel da loja: Configurações → Chave API).
  - `chave_aplicacao` — identifica o **integrador/app** (UUID). Obtida via
    suporte técnico da Loja Integrada para o app W3ADS.
- **Envio (preferir header):**
  ```
  Authorization: chave_api <CHAVE_API> aplicacao <CHAVE_APLICACAO>
  Content-Type: application/json
  ```
  Alternativa por query string: `?chave_api=<...>&chave_aplicacao=<...>`
- Sempre anexar `?format=json`.

## Rate limit (throttling)

| Escopo | Limite | Erro |
|--------|--------|------|
| por loja (`chave_api`) | 100 req/min | 429 (Err 633) |
| por aplicação (`chave_aplicacao`) | 3000 req/min | 429 (Err 533) |
| por IP | 1200 req/min | 429 (Err 133) |

→ Sync deve respeitar 100 req/min/loja: retry com backoff em 429, throttle
client-side (~1 req / 600ms folga).

## Paginação (Django Tastypie)

Todos os list endpoints:
```
GET /<recurso>/?format=json&limit=100&offset=0
```
Resposta:
```json
{
  "meta": { "limit": 100, "offset": 0, "total_count": 1234,
            "next": "/api/v1/pedido/search/?...&offset=100",
            "previous": null },
  "objects": [ /* ... */ ]
}
```
- `limit` máximo = 100. Iterar via `offset` até `meta.next === null`.

## Pedidos (núcleo do dashboard)

- **Listar/buscar:** `GET /pedido/search/`
  Filtros:
  - `since_atualizado` — pedidos atualizados a partir de data/hora.
    Formato `AAAA-MM-DDTHH:MM:SS` (hora opcional). **Chave do sync incremental.**
  - `since_criado` / `until_criado` — janela por data de criação.
  - `situacao_id`, `cliente_id`, `pagamento_id`, `since_numero`.
  - `limit`, `offset`.
- **Detalhe:** `GET /pedido/{numero}/`
- **Situações (status):**
  | código | significado |
  |--------|-------------|
  | 2 | Aguardando pagamento |
  | 3 | Em análise |
  | 4 | Pago |
  | 6 | Em disputa |
  | 7 | Pagamento devolvido |
  | 8 | Cancelado |
  | 9 | Efetuado (padrão) |
  | 11 | Enviado |
  | 13 | Pronto p/ retirada |
  | 14 | Entregue |
- Campos relevantes p/ métricas: `numero`, `valor_total` / `valor_subtotal`,
  `situacao`, `data_criacao`, `cliente`, `itens[]`, `pagamentos[]`, `envios[]`.
  (Confirmar nomes exatos no primeiro fetch real — Tastypie expõe os campos do model.)

## Produtos

- **Listar:** `GET /produto/?format=json&limit=100&offset=0`
  - `?description_html=1` para trazer descrição.
  - Filtro por data: `data_modificacao__gte`, `data_criacao__gte` (+ `__lt/__lte/__gt`).
- **Detalhe:** `GET /produto/{id}/`

## Estoque / Preço (opcional, fase 2)

- `GET /produto_estoque/` — estoques.
- `GET /produto_preco/` — preços.

## Estratégia de sync recomendada

1. Backfill inicial: `since_criado` = (hoje − N dias) configurável, paginando por offset.
2. Sync incremental: guardar `lastSyncAt`; usar `since_atualizado=lastSyncAt`.
3. Throttle ≤ 100 req/min; retry exponencial em 429 (respeitar `Retry-After` se houver).
4. Self-heal: se offset travar (next nunca null), cap de páginas + log.
5. Normalizar pedidos pagos/efetuados (4, 9, 11, 14) como receita; excluir 8 (cancelado) e 7 (devolvido).
