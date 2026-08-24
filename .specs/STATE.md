# STATE — W3 Marketplace

## Decisions

### AD-001 — Granularidade do alerta de ROAS por plataforma (2026-08-24)
O endpoint Shopee Ads em uso (`get_all_cpc_ads_daily_performance`) é agregado
por dia no nível de CONTA (sem `campaignId`). A regra de queda de ROAS passa a
operar em dois modos: nível campanha onde o dado existe (Mercado Livre Ads) e
nível conta/workspace para Shopee. Alerta por campanha Shopee fica condicionado
à verificação de endpoints na OpenAPI (fase 2). Confirmado pelo usuário
("pode aplicar" sobre default recomendado).

### AD-002 — Atributos de produto para kits derivados por IA (2026-08-24)
Os 700+ produtos não têm gênero/faixa etária/cor cadastrados de forma
confiável. Os atributos normalizados são derivados por IA (Gemini, infra BYOK
já existente em `ai-copy.ts` + `WorkspaceAiConfig`) a partir de título,
categoria do marketplace e imagens, com revisão/override manual inline.
Confirmado por delegação ("você decide").

### AD-003 — Kits exigem aprovação humana antes de publicar (2026-08-24)
O MVP gera propostas de kit; publicação automática sem gate humano fica fora
do escopo. Confirmado por delegação.

## Handoff snapshot (2026-08-24)

- Branch: `feat/drive-dashboard-notificacoes` @ `b306a3f` (deployado em produção).
- Drive global da plataforma conectado e validado (PlatformStorage row ok).
- OAuth Google trocado para cliente Web `654176400684-ot7q...` (projeto
  `directed-strata-423616-f4`, consent em Testing, testador configurado).
- Pendências operacionais: resetar o client_secret exposto em chat após
  estabilizar; rotacionar token Upstash antigo se ainda válido.
- Features em especificação: `roas-anomaly-insights`, `kit-generator`.
