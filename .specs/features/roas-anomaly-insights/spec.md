# ROAS Anomaly & Insights Specification

## Problem Statement

A operação roda centenas de anúncios ativos e só percebe queda de performance
quando o faturamento já caiu. O motor de notificações atual detecta queda de
ROAS por campanha, mas o dado de Shopee Ads chega agregado por conta, então a
regra não dispara para a maior fonte de anúncios da operação. Faltam também
janelas comparativas longas (7/30/90 dias), estimativa de runway de estoque
acoplada ao anúncio e uma recomendação de ação junto do alerta.

## Goals

- [ ] Queda brusca de ROAS dispara alerta para Shopee (nível conta) e Mercado Livre (nível campanha) sem falsos positivos por atraso de atribuição.
- [ ] Gestor vê relatório de ROAS com janelas 7/30/90 dias por plataforma em até 2 cliques a partir de `/relatorios`.
- [ ] Todo alerta de estoque baixo indica quantos dias restam de estoque quando há histórico de vendas suficiente.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Relatórios táticos/qualidade de anúncio da Shopee ("Business Insights") | Disponibilidade na OpenAPI pública não confirmada; requer pesquisa prévia nos docs oficiais. Reabrir como feature própria após verificação. |
| Alerta de ROAS por campanha na Shopee | Depende dos mesmos endpoints não verificados; fase 2 condicionada (AD-001). |
| Pausa automática de campanhas pelo sistema | Decisão de mídia paga é humana; sistema apenas recomenda. |
| Notificações via push mobile | Não há app mobile; in-app + canais externos cobrem. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Granularidade do alerta Shopee | Nível conta/workspace no MVP; campanha fica fase 2 | Único dado disponível hoje no endpoint atual; entrega imediata | y (delegado) |
| Compensação de atribuição Shopee | Janelas de comparação excluem as últimas 72h (constante configurável) | Conversões boleto/Pix fecham em 48–72h; evita queda falsa | y (delegado) |
| Runway de estoque | `estoque ÷ média de unidades vendidas/dia (últimos 14d)` calculado dos pedidos sincronizados | Dados já existem em EcommerceOrder/ProductInventory | y (delegado) |
| Canais externos de notificação | P2: webhook genérico (Discord/Slack compatível) + e-mail Resend por workspace, herdando dedup de 24h | In-app já resolve MVP; canal externo é amplificador | y (delegado) |
| Matriz causa→ação | P2, baseada em sinais já medidos (CTR, conversão, estoque, preço) | Depende dos relatórios P1 existirem | y (delegado) |
| Limiares da matriz causa→ação | CTR estável = razão recente/baseline ≥ 0,85; conversão em queda = razão ≤ 0,75; runway útil ≤ 14 dias | A spec não fixava números; defaults conservadores e diretamente testáveis | y (delegado) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Alerta de queda de ROAS no nível conta (Shopee) ⭐ MVP

**User Story**: As a gestor de mídia, I want um alerta quando o ROAS da conta
Shopee cair drasticamente versus a semana anterior so that eu investigue antes
do prejuízo acumular.

**Why P1**: Shopee é a maior fonte de anúncios e hoje nenhuma regra dispara
para ela.

**Acceptance Criteria**:

1. WHEN o ROAS da conta Shopee nos últimos 3 dias úteis de atribuição for menor que 50% do ROAS da janela baseline de 7 dias anteriores THEN system SHALL criar uma notificação `roas_drop` com severidade `warning` vinculada à conta.
2. WHEN a razão entre ROAS recente e baseline for menor que 25% THEN system SHALL marcar a notificação como `critical`.
3. IF a conta Shopee tiver gasto baseline menor que R$50 ou gasto recente menor que R$20 THEN system SHALL não gerar alerta.
4. IF o ROAS baseline da conta for menor que 3 THEN system SHALL não gerar alerta.
5. WHEN qualquer janela de comparação for calculada para Shopee THEN system SHALL excluir da janela recente as últimas 72 horas antes de agregar métricas.
6. IF já existir notificação `roas_drop` para a mesma conta nas últimas 24h THEN system SHALL não criar nova notificação.

**Independent Test**: Popular DailyMetric com série simulada (baseline ROAS 10,
recente ROAS 3) e rodar o avaliador; verificar notificação criada uma única vez
em duas execuções seguidas.

### P1: Estoque crítico com runway em anúncio publicado ⭐ MVP

**User Story**: As a gestor de e-commerce, I want saber quantos dias de estoque
restam num anúncio publicado e vendendo so that eu repora ou pause antes de
matar a campanha.

**Why P1**: Estoque zerado em anúncio ativo derruba vendas sem sinal claro;
runway transforma o alerta em decisão.

**Acceptance Criteria**:

1. WHILE um produto publicado tenha estoque ao vivo menor ou igual a 5 unidades THEN system SHALL manter a notificação `low_stock` existente com severidade conforme limiar atual (`warning` ≤5, `critical` ≤2).
2. WHEN existirem pedidos suficientes para calcular média de unidades/dia nos últimos 14 dias THEN system SHALL incluir no corpo e metadata da notificação o runway em dias (`estoque ÷ média diária`, arredondado para cima).
3. IF o produto estiver com status diferente de `publicado` THEN system SHALL não gerar notificação de estoque.
4. WHEN a média diária de vendas for zero ou indisponível THEN system SHALL omitir o runway sem bloquear o alerta de estoque baixo.
5. IF o estoque ao vivo não estiver disponível THEN system SHALL usar a quantidade publicada como fallback, mantendo o comportamento atual.

**Independent Test**: Produto publicado com estoque 4 e 2 vendas/dia →
notificação informa "≈2 dias"; mesmo cenário sem pedidos → notificação sem
runway.

### P1: Relatório de ROAS 7/30/90 dias ⭐ MVP

**User Story**: As a analista, I want relatórios de ROAS em janelas de 7, 30 e
90 dias por plataforma so that eu apresente evolução e justifique investimento.

**Why P1**: Hoje o painel mostra visão curta; decisões de verba precisam de
janelas longas.

**Acceptance Criteria**:

1. WHEN o usuário abrir `/relatorios` THEN system SHALL exibir seletor de janela com opções 7, 30 e 90 dias aplicado às métricas de investimento, receita, ROAS, pedidos e CTR.
2. WHEN a janela selecionada for maior que o histórico sincronizado THEN system SHALL exibir os dados disponíveis acompanhados do aviso "histórico desde {data}".
3. WHILE a visualização esteja filtrada por uma plataforma THEN system SHALL somar apenas métricas daquela fonte (Shopee Ads ou Mercado Livre Ads).
4. IF o workspace não tiver métricas no período THEN system SHALL exibir estado vazio orientando conectar contas em `/connectors`.

**Independent Test**: Workspace com dados sintéticos de 120 dias renderiza as
três janelas com totais conferíveis; workspace vazio mostra estado vazio.

### P2: Canais externos de notificação

**User Story**: As a gestor, I want receber os alertas no Discord/e-mail so that
eu não precise abrir a plataforma para saber que algo caiu.

**Why P2**: Amplifica o MVP; inbox in-app já entrega o valor central.

**Acceptance Criteria**:

1. WHERE um workspace tenha webhook configurado THEN system SHALL entregar cada notificação persistida ao canal externo dentro de 60 segundos com payload contendo workspace, tipo, severidade, título, corpo e metadata.
2. IF a entrega falhar THEN system SHALL tentar novamente até 3 vezes com backoff exponencial e registrar falha final no log sem bloquear o sync.
3. WHEN a notificação estiver em cooldown de 24h THEN system SHALL não entregá-la ao canal externo.
4. The system SHALL suportar no máximo 1 webhook e 1 destinatário de e-mail por workspace no MVP.

**Independent Test**: Webhook de teste (webhook.site) recebe payload ao criar
notificação; desconectar o endpoint produz 3 retries e log.

### P2: Recomendação de ação no alerta (matriz causa→ação)

**User Story**: As a gestor, I want cada alerta trazer a causa provável e a
ação sugerida so that eu execute a correção sem diagnóstico manual.

**Why P2**: Depende das janelas e sinais do P1.

**Acceptance Criteria**:

1. WHEN um alerta `roas_drop` for gerado THEN system SHALL anexar em metadata a causa provável escolhida pela matriz: queda de conversão com CTR estável sugere preço/estoque; CTR em queda sugere criativo/título.
2. WHEN um alerta `low_stock` incluir runway menor ou igual a 7 dias THEN system SHALL sugerir reposição imediata; entre 8 e 14 dias, sugerir programar reposição.
3. IF os sinais necessários para a matriz não estiverem disponíveis THEN system SHALL anexar a recomendação genérica atual do alerta.

**Independent Test**: Série com CTR estável e conversão em queda produz
metadata com causa "preço/estoque"; série sem cliques produz recomendação
genérica.

---

## Edge Cases

- IF a conta Shopee Ads estiver revogada/expirada THEN system SHALL não calcular janelas nem disparar alerta de conta até reconexão (a regra `account_quality` cobre o aviso).
- IF dois syncs rodarem concorrentes THEN system SHALL avaliar regras sob o advisory lock existente sem duplicar notificações.
- WHEN o histórico começar no meio de uma janela baseline THEN system SHALL aplicar os pisos de gasto normalmente (baseline curto tende a ficar abaixo do piso e não alerta).
- IF o fuso do `date` de DailyMetric deslocar uma venda para o dia seguinte THEN system SHALL tratar a janela por data de registro (comportamento atual), nunca por timestamp parcial.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| ROAS-01 | P1: Alerta nível conta Shopee | Design | Pending |
| ROAS-02 | P1: Severidades warning/critical | - | Pending |
| ROAS-03 | P1: Pisos de gasto | - | Pending |
| ROAS-04 | P1: Baseline mínimo | - | Pending |
| ROAS-05 | P1: Lag de atribuição 72h | - | Pending |
| ROAS-06 | P1: Dedup 24h | - | Pending |
| STCK-01 | P1: Limiares de estoque | - | Pending |
| STCK-02 | P1: Runway na notificação | - | Pending |
| STCK-03 | P1: Filtro status publicado | - | Pending |
| STCK-04 | P1: Runway ausente não bloqueia | - | Pending |
| STCK-05 | P1: Fallback quantidade publicada | - | Pending |
| REPT-01 | P1: Seletor 7/30/90d | - | Pending |
| REPT-02 | P1: Histórico parcial | - | Pending |
| REPT-03 | P1: Filtro por plataforma | - | Pending |
| REPT-04 | P1: Estado vazio | - | Pending |
| CHAN-01 | P2: Entrega webhook ≤60s | - | Pending |
| CHAN-02 | P2: Retry 3x backoff | - | Pending |
| CHAN-03 | P2: Cooldown herda dedup | - | Pending |
| CHAN-04 | P2: Limites por workspace | - | Pending |
| ACTN-01 | P2: Matriz causa roas_drop | - | Pending |
| ACTN-02 | P2: Sugestão por runway | - | Pending |
| ACTN-03 | P2: Fallback recomendação genérica | - | Pending |

**Coverage:** 22 total, 0 mapped to tasks yet, 22 unmapped (Tasks phase).

---

## Success Criteria

- [ ] Série simulada ROAS 10→3 na Shopee gera exatamente 1 notificação critical em execução repetida.
- [ ] Zero alertas disparados por janelas contendo as últimas 72h incompletas de atribuição.
- [ ] `/relatorios` renderiza 7/30/90d para workspaces com ≥120 dias de dados sem erro e com aviso de histórico parcial onde aplicável.
- [ ] 100% dos alertas `low_stock` com vendas registradas trazem runway em dias.
