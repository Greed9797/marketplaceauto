# Design — Copilot Eval Harness

## Componentes (reusa Onda 1/3)
- `src/lib/copilot/harness.ts` (novo): `evaluateListing`, `runHarness`.
- Reusa: `minimaxChat` + `COPILOT_TOOLS` + `executeCopilotTool`,
  `buildCopilotSystem`, `calcularScore`, `previewPublishMl/Shopee` (traz
  `validation` + `requiredAttributes`).
- `POST /api/copilot/harness` (novo): guarda workspace, roda `runHarness`.
- Botão na `otimizar-client.tsx` chamando o endpoint + render do relatório.

## Avaliador (harness de qualidade)
`evaluateListing(produtoId, workspaceId)`:
1. `calcularScore` → `completude` (0-100) + dicas.
2. `previewPublishMl/Shopee` → `publicavel` (todas conectadas ok) +
   pendências (mensagens).
3. Julgamento M3 (1 call, sem tools, JSON): `{score 0-100, feedback[]}` sobre
   qualidade de título/descrição vs produto. Best-effort; se falhar, usa só o
   determinístico.
4. `scoreFinal = round(0.5*completude + 0.5*juizM3)` (se juiz indisponível,
   = completude). `feedback` = pendências + dicas + feedback do juiz.

## Gerador
`generateRound(produtoId, workspaceId, feedback)`:
- `buildCopilotSystem` + user msg: "Melhore ao máximo. Pendências/feedback: …".
- `minimaxChat({tools: COPILOT_TOOLS})` → filtra tool_calls `atualizar_produto`;
  aplica cada um via `executeCopilotTool`. Retorna `{applied[], resumo}`.

## Loop
```
rounds = []
for n in 1..maxRounds:
  ev = evaluateListing()
  rounds.push({n, score: ev.score, publicavel, feedback})
  if ev.score >= threshold && ev.publicavel: break
  gen = generateRound(ev.feedback)
  if gen.applied.length === 0: break            // convergiu/travou
  rounds[last].applied = gen.applied
final = evaluateListing()
return { rounds, finalScore: final.score, publicavel: final.publicavel,
         converged: final.score >= threshold }
```

## Guardrails
- `maxRounds` clamp [1,6], `threshold` clamp [50,100] (default 85).
- Auto-apply só `atualizar_produto`; `publicar` ignorado no harness.
- Cada chamada M3 com timeout (já no `minimaxChat`). Endpoint `maxDuration=300`.

## Teste
Unit puro do combinador de score + decisão de parada (`combineScore`,
`shouldStop`) — sem M3/prisma.
