# Kit Generator Specification

## Problem Statement

A operação tem mais de 700 anúncios individuais ativos e sabe, empiricamente,
que anúncios em formato de "kit" performam melhor — mas montar combos à mão é
lento e arriscado: misturar itens incompatíveis (vestido feminino com conjunto
masculino) gera anúncio sem sentido e devolução. Falta uma esteira que
classifique os produtos por atributos e proponha kits coerentes em escala,
com trava de estoque e coerência de preço.

## Goals

- [ ] 100% dos produtos publicados classificados com atributos normalizados (gênero, faixa etária, categoria-chave) sem cadastro manual item a item.
- [ ] Motor propõe lotes de kits compatíveis (mesmo gênero + faixa etária; categorias homogêneas ou pares complementares aprovados) com estoque mínimo garantido em todas as SKUs.
- [ ] Nenhum kit chega ao marketplace sem aprovação humana.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Publicação automática de kits sem aprovação humana | Risco comercial de anúncio incoerente; AD-003 |
| Kits no Mercado Livre | MVP começa pela Shopee onde está o volume; ML na fase 2 |
| Precificação dinâmica de kits | Preço do kit é definido pelo gestor na aprovação |
| Anúncios de variação (tamanho/cor) dentro do kit | Depende da fase de publicação (P2); geração só agrupa SKUs |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Origem dos atributos | IA extrai atributos semânticos de título + categoria do marketplace (`atributos` Json do Produto), com edição manual inline; preço vem de `Produto.preco` | 700+ itens inviabilizam cadastro manual; preço persistido é mais confiável que inferência por IA | y (AD-002 + decisão do usuário em 2026-08-24) |
| Camada 1 rígida | Mesmo `gender` E mesma `ageBand` são pré-requisito de qualquer cruzamento | Regra inegociável do briefing | y |
| Camada 2 categorias | Kits homogêneos (2+ da mesma `categoryKey`) sempre permitidos; complementares somente por matriz de pares aprovados semeada manualmente e editável | Impede combinações sem sentido sem bloquear escala | y (delegado) |
| Trava de estoque | Toda SKU componente precisa de estoque ≥2 unidades (configurável) | Evita kit invalidado por grade quebrada | y (delegado) |
| Coerência de preço | Componentes de um kit dentro de faixa 1:5 (preço máximo ≤5× mínimo) | Evita mistura entrada+premium sem justificativa | y (delegado) |
| Kits monótonos | Gerador prefere cores distintas; kit com cores idênticas só é proposto se marcado como "mesma cor" proposital | Briefing aponta redundância como risco | y (delegado) |
| Estoque considerado | Estoque ao vivo (ProductInventory) quando existir; senão `quantidade` publicada | Mesma fonte da regra low_stock atual | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Classificação de atributos com IA ⭐ MVP

**User Story**: As a gestor de catálogo, I want os 700+ produtos classificados
automaticamente por gênero, faixa etária e categoria-chave so that o motor de
kits opere sobre dados confiáveis sem trabalho manual.

**Why P1**: Sem atributos normalizados nenhuma camada de compatibilidade funciona.

**Acceptance Criteria**:

1. WHEN um produto publicado não tiver atributos normalizados THEN system SHALL derivar `gender`, `ageBand`, `categoryKey` e `colorPattern` via IA a partir de título, descrição e categoria do marketplace; o motor SHALL usar `Produto.preco` como fonte de preço, sem inferi-lo por IA.
2. WHEN a IA retornar confiança menor que 0.7 para qualquer atributo THEN system SHALL marcar o produto para revisão manual em vez de usá-lo nos cruzamentos.
3. IF a chamada de IA falhar ou o workspace não tiver chave configurada THEN system SHALL enfileirar o produto para retry na próxima execução e seguir o lote sem interromper.
4. WHEN o usuário editar um atributo manualmente THEN system SHALL gravar origem `manual` e nunca sobrescrevê-lo em reprocessamentos.
5. The system SHALL processar o catálogo em lotes de no máximo 50 produtos por execução com retomada determinística (produtos já classificados com origem `ai`/`manual` são pulados).

**Independent Test**: Lote de 10 títulos reais classificado → JSON de atributos
conferível; título ambíguo ("conjunto moletom unissex") cai em revisão manual.

### P1: Motor de propostas de kit ⭐ MVP

**User Story**: As a analista de mídia, I want lotes de propostas de kit
compatíveis com motivo explicado so that eu aprove combos bons em minutos.

**Why P1**: É o coração do pedido: cruzamento seguro em escala.

**Acceptance Criteria**:

1. WHILE dois produtos tenham o mesmo `gender` e a mesma `ageBand` THEN system SHALL considerá-los candidatos a cruzamento; caso contrário SHALL excluí-los.
2. WHEN o motor gerar uma proposta THEN system SHALL compor apenas kits homogêneos (2–5 itens da mesma `categoryKey`) ou pares complementares presentes na matriz aprovada.
3. IF qualquer SKU componente tiver estoque menor que o mínimo configurado (default 2) THEN system SHALL descartar a proposta.
4. IF a razão entre o maior e o menor preço dos componentes exceder 5 THEN system SHALL descartar a proposta.
5. WHEN uma proposta for gerada THEN system SHALL incluir o motivo legível (camada aplicada: homogêneo/par complementar, giro dos componentes).
6. WHEN existirem componentes da mesma `categoryKey` no kit THEN system SHALL preferir `colorPattern` distintos e sinalizar propostas monocromáticas com flag explícita.
7. The system SHALL ordenar as propostas priorizando componentes de alta saída combinados com giro mais lento quando houver dados de venda suficientes.

**Independent Test**: Catálogo sintético com pares válidos e inválidos
(gênero divergente, estoque 1, preço 10x) → apenas os válidos viram propostas
com motivo.

### P1: Revisão e ciclo de vida do kit ⭐ MVP

**User Story**: As a gestor, I want aprovar/rejeitar propostas com um clique e
ver meus kits aprovados so that nada publique sem decisão humana.

**Why P1**: Gate de segurança comercial (AD-003).

**Acceptance Criteria**:

1. WHEN o usuário aprovar uma proposta THEN system SHALL persistir o kit com status `aprovado`, componentes referenciados, preço definido pelo usuário e um `Produto` derivado 1:1 em rascunho, com título, descrição e galeria sugeridos a partir dos componentes para revisão antes da publicação.
2. WHEN o usuário rejeitar uma proposta THEN system SHALL registrar a rejeição e não repropor a mesma combinação de componentes.
3. IF uma SKU de kit aprovado tiver estoque abaixo do mínimo THEN system SHALL marcar o kit como `bloqueado` até reposição.
4. The system SHALL exibir a lista de kits com status (`proposta`, `aprovado`, `rejeitado`, `bloqueado`) filtrável por cliente/workspace.

**Independent Test**: Aprovar proposta cria kit visível; reprovar impede
reproposta idêntica; zerar estoque de componente bloqueia o kit.

### P2: Publicação de kits aprovados na Shopee

**User Story**: As a gestor, I want publicar kits aprovados em lote na Shopee
so that eu capture o ganho de ticket sem operação manual.

**Why P2**: Depende do ciclo P1 maduro e integra o publisher existente.

**Acceptance Criteria**:

1. WHEN o usuário selecionar kits `aprovados` e acionar publicação THEN system SHALL publicar o `Produto` derivado pelo fluxo Shopee existente, com imagens dos componentes e preço do kit; categoria só SHALL ser sugerida automaticamente quando todos os componentes tiverem a mesma `categoriaShopeeId` não nula, caso contrário a publicação SHALL exigir confirmação manual no editor.
2. WHEN a publicação de um kit falhar THEN system SHALL reportar o erro por kit sem interromper o lote.
3. IF o estoque de algum componente caísse abaixo do mínimo no momento da publicação THEN system SHALL pular o kit e marcá-lo `bloqueado`.

**Independent Test**: Dois kits aprovados publicados em lote; simular falha em
um e verificar relatório parcial.

---

## Edge Cases

- IF um produto aparecer duplicado (mesmo `shopeeItemId`) THEN system SHALL classificar apenas um registro e ignorar o par nas propostas.
- WHEN a IA classificar `gender` como `unissex` THEN system SHALL permitir cruzamento com ambos os gêneros mantendo a camada 1.
- IF o catálogo de um cliente mudar de categoria após o kit aprovado THEN system SHALL recalcular validade na próxima avaliação e bloquear em caso de incompatibilidade.
- WHEN não houver pares complementares aprovados ainda THEN system SHALL gerar apenas kits homogêneos.
- IF o workspace não tiver chave de IA nem fallback global THEN system SHALL exibir orientação para configurar em `/workspace/settings`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| KIT-01 | P1: Derivação IA de atributos | T1-T3 | Complete |
| KIT-02 | P1: Limiar de confiança 0.7 | T3, T8 | Complete |
| KIT-03 | P1: Falha de IA não bloqueia lote | T3-T4 | Complete |
| KIT-04 | P1: Override manual permanente | T1, T3, T8 | Complete |
| KIT-05 | P1: Lote ≤50 com retomada | T3-T4 | Complete |
| KIT-06 | P1: Camada 1 gênero+idade | T5 | Complete |
| KIT-07 | P1: Homogêneos e matriz de pares | T5 | Complete |
| KIT-08 | P1: Trava de estoque ≥2 | T5 | Complete |
| KIT-09 | P1: Faixa de preço 1:5 | T5 | Complete |
| KIT-10 | P1: Motivo na proposta | T5 | Complete |
| KIT-11 | P1: Preferência cor distinta | T5 | Complete |
| KIT-12 | P1: Priorização giro alto+lento | T5-T6 | Complete |
| KIT-13 | P1: Aprovação persiste kit + Produto derivado revisável | T7, T9 | Complete |
| KIT-14 | P1: Rejeição impede reproposta | T1, T6-T7 | Complete |
| KIT-15 | P1: Bloqueio por estoque | T7 | Complete |
| KIT-16 | P1: Lista com status/filtros | T7-T8 | Complete |
| KPUB-01 | P2: Publicação em lote Shopee | T9-T12 | In Progress |
| KPUB-02 | P2: Falha isolada por kit | T10-T12 | In Progress |
| KPUB-03 | P2: Checagem de estoque no publish | T10-T11 | Complete |

**Coverage:** 19 total, 19 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] Catálogo piloto (≥500 produtos) classificado com ≥90% dos itens fora de revisão manual em uma passada.
- [ ] Zero propostas violando camada 1 (gênero/faixa etária), trava de estoque ou faixa de preço em amostra auditada de 100 propostas.
- [ ] Tempo médio de aprovação de um lote de 20 propostas < 10 minutos na UI.
