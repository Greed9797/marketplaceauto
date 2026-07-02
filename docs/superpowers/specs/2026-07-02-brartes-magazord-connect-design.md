# Br Artes — Conexão MagaZord (design)

Data: 2026-07-02 · Status: aprovado (execução direta)

## Objetivo
Faturamento/pedidos da loja MagaZord da Br Artes no dashboard, igual à integração
NuvemShop da Cotton Chic. Loja roda SÓ MagaZord (confirmado).

## Contexto
- Provider MAGAZORD já implementado (`ManualCommerceClient`: `magazordOrdersUrl`,
  auth Basic `apiUser:apiPassword`, parser; `SYNC_HELPERS.MAGAZORD` → `syncEcommerceOrders`).
  Primeira conta MAGAZORD em prod (WBUY/ISET manuais já rodam).
- Workspace Br Artes: `cmqh06inv000akfihuf87624f` (GOOGLE_ADS + GA4 ativos, sem e-commerce).
- Credenciais validadas (HTTP 200): baseUrl `https://brartes.painel.magazord.com.br`
  (SEM `/api` — `providerOrdersPath` default já é `/api/v2/site/pedido`).

## Solução
Replicar o estado final da rota oficial `/api/connectors/manual` (sem UI, direto no prod):
1. Vault secret `w3ads:{ws}:MAGAZORD:{externalAccountId}:credentials` com JSON
   `{baseUrl, apiUser, apiPassword}` via `vault.create_secret`.
2. `ConnectorAccount` (schema `w3ads`): provider MAGAZORD, accountName "Br Artes",
   `externalAccountId = sha256("MAGAZORD:{baseUrl}:{storeName}".lower())[:32]`,
   campos inline = sentinela "vault", `credentialSecretId`, status ACTIVE,
   metadata `{credentialMode:"manual", syncMode:<copiar padrão das contas WBUY/ISET>}`.
3. Sync: cron de prod (workspace-sync) assume — foreground mês atual + backfill
   histórico em fatias (`historicalSyncedAt`/`historicalBackfillUntil` null → pendente).
4. Verificação: comparar DB vs API MagaZord (contagem + soma por período) e
   entregar relatório de conferência.

## Fora de escopo
NuvemShop pra Br Artes (não tem loja NuvemShop). ProviderConfig MAGAZORD de UI
(criação direta dispensa; adicionar se um dia forem conectar outra loja MagaZord via UI).

## Riscos
- Parser MagaZord nunca exercitado em prod → mitigado pela verificação final vs API.
- Cron pode demorar até o próximo tick → verificar agendamento; se preciso, aguardar.
