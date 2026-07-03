# Spec — Copilot Eval Harness (gerador↔avaliador)

## Objetivo
Loop estilo GAN pro copiloto: **gerador** (M3) melhora o anúncio, **avaliador**
(harness de qualidade) pontua 0–100 + feedback, repete até passar o limiar ou
esgotar as rodadas. Roda contra dados reais (prod), M3 real.

## Decisões do usuário
- Tipo: eval harness da IA (gerador↔avaliador). (não E2E, não CI)
- Alvo: deploy prod, dados reais.

## Requisitos
- **R1 (funcional/gerador):** dado um `produtoId`, o gerador chama M3 com a
  whitelist e propõe `atualizar_produto`; o harness **auto-aplica** só
  `atualizar_produto` (conteúdo, reversível). NUNCA auto-publica (ação
  irreversível permanece sugere→aprova).
- **R2 (qualidade/avaliador):** avalia o anúncio e devolve `{score 0-100,
  publicavel, feedback[]}`. Score = completude determinística (`calcularScore`)
  combinada com julgamento de copy do M3; `publicavel` = gate
  `validarPublicavel` das plataformas conectadas; `feedback` alimenta a próxima
  rodada do gerador.
- **R3 (loop):** `runHarness({produtoId, maxRounds, threshold})` roda
  avaliar→gerar→aplicar até `score>=threshold && publicavel` ou `maxRounds`,
  ou convergência (gerador não propôs mudança). Retorna relatório por rodada.
- **R4 (guardrails):** escopo por workspace; teto de rodadas (default 3, máx 6);
  só `atualizar_produto` no auto-apply; timeouts nas chamadas M3.
- **R5 (superfície):** `POST /api/copilot/harness` + botão "Otimizar com IA
  (auto)" na tela de otimização mostrando o relatório rodada-a-rodada.

## Fora de escopo
- Auto-publicar. E2E Playwright. Fine-tuning. Persistir histórico de rodadas.
