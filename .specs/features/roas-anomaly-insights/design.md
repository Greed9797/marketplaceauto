# ROAS Anomaly & Insights Design

**Spec**: `.specs/features/roas-anomaly-insights/spec.md`
**Status**: Draft

---

## Architecture Overview

Evolução incremental do motor existente (`src/lib/notifications/rules.ts`) em
vez de motor paralelo: nova regra de conta-Shopee ao lado da regra de campanha,
runway embutido na regra de estoque atual, camada de relatório sobre
`DailyMetric` + `EcommerceOrder` e dispatcher de canais externos disparado
após `persistDrafts`. Nenhuma tabela existente é migrada; só a nova
`NotificationChannel` (P2).

```mermaid
graph TD
    S[Sync orchestrator] --> E[evaluateWorkspaceNotificationRules]
    E --> R1[detectRoasDrops campanha/ML - atual]
    E --> R2[detectShopeeAccountRoasDrop novo]
    E --> R3[detectLowStock + runway]
    E --> R4[account_quality - atual]
    R2 --> W[roas-windows.ts puro: lag 72h]
    R3 --> RW[runway.ts puro]
    E --> P[persistDrafts + advisory lock]
    P --> CH[channels dispatcher P2: webhook + Resend]
    Q[/relatorios UI] --> RR[metrics/roas-report.ts 7/30/90d]
```

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --------- | -------- | ---------- |
| NotificationDraft, persistDrafts, cooldown/advisory lock | `src/lib/notifications/rules.ts` | Nova regra produz os mesmos drafts; dedup herdado |
| Pisos/severidades da regra de campanha | `src/lib/notifications/rules.ts` | Mesmos limiares no nível conta |
| Agregação de métricas gerais | `src/lib/metrics/general-overview.ts` | Padrão de pareamento gasto (DailyMetric) × receita (EcommerceOrder) |
| Retry com backoff | `src/lib/connectors/retry.ts` (`callWithRetry`) | Dispatcher de canal externo |
| Envio de e-mail | `src/lib/email/resend.ts` | Canal e-mail (P2) |
| Página de relatórios | `src/app/(app)/relatorios/page.tsx` + `relatorio-client.tsx` | Estender com seletor de janela/filtro |

### Integration Points

| System | Integration Method |
| ------ | ------------------ |
| Sync orchestrator | `evaluateWorkspaceNotificationRules` já chamado ao fim do sync; nova regra entra na mesma `Promise.all` protegida por catch |
| Database | Leitura `DailyMetric` (spend) + `EcommerceOrder`/`ProductInventory` (receita/estoque); escrita apenas em `Notification` e nova `NotificationChannel` |

---

## Components

### roas-windows (puro)

- **Purpose**: Janelas recent/baseline com compensação de atribuição; razão de ROAS.
- **Location**: `src/lib/notifications/roas-windows.ts`
- **Interfaces**:
  - `computeLaggedWindows(now: Date, lagHours: number): { recentStart; baselineStart; baselineEnd }`
  - `roasRatio(baselineRoas: number, recentRoas: number): number`
- **Dependencies**: nenhuma (testável isoladamente).
- **Reuses**: semântica das janelas contíguas de `detectRoasDrops`.

### shopee-account-rule

- **Purpose**: Detectar queda de ROAS no nível da conta Shopee Ads.
- **Location**: `src/lib/notifications/shopee-account-rule.ts`
- **Interfaces**:
  - `detectShopeeAccountRoasDrop(workspaceId: string): Promise<NotificationDraft[]>`
- **Dependencies**: `prisma`, `roas-windows`.
- **Reuses**: limiares `ROAS_*` (exportados de `rules.ts`); `entityId = connectorAccountId` para o dedup 24h existente.

### runway (puro)

- **Purpose**: `estoque ÷ média unidades/dia (14d)` → dias restantes arredondados p/ cima.
- **Location**: `src/lib/notifications/runway.ts`
- **Interfaces**: `computeRunwayDays(stock: number, unitsPerDay: number | null): number | null`
- **Dependencies**: nenhuma.
- **Reuses**: fontes de estoque já usadas por `detectLowStock`.

### roas-report

- **Purpose**: Série diária + totais de investimento/receita/ROAS/pedidos/CTR por janela (7/30/90) e por fonte, sinalizando histórico parcial.
- **Location**: `src/lib/metrics/roas-report.ts`
- **Interfaces**: `getRoasReport(workspaceId, windowDays: 7|30|90, source?): Promise<RoasReport>`
- **Dependencies**: `prisma`.
- **Reuses**: padrões de consulta de `general-overview.ts`.

### channels dispatcher (P2)

- **Purpose**: Entregar notificações persistidas a webhook/e-mail com retry.
- **Location**: `src/lib/notifications/channels.ts`
- **Interfaces**: `dispatchNotifications(workspaceId, notifications: Notification[])`
- **Dependencies**: `callWithRetry`, `resend.ts`, modelo `NotificationChannel`.
- **Reuses**: cooldown já aplicado em `persistDrafts` (só entrega o que foi criado).

### causes (P2)

- **Purpose**: Matriz causa→ação anexada aos drafts.
- **Location**: `src/lib/notifications/causes.ts`
- **Interfaces**: `attachRecommendation(draft, signals): NotificationDraft`
- **Dependencies**: tipos de `rules.ts`.
- **Reuses**: sinais já calculados nas janelas (CTR/conversão) e runway.

---

## Data Models (P2)

### NotificationChannel

```typescript
interface NotificationChannel {
  id: string
  workspaceId: string // unique — máx. 1 linha por workspace (CHAN-04)
  webhookUrl?: string | null
  notifyEmail?: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}
```

**Relationships**: 1:1 com `Workspace` (cascade delete). Sem FK em `Notification`.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| -------------- | -------- | ----------- |
| Falha da regra de conta Shopee | catch por regra (padrão atual) + console.error estruturado | Sync segue; alertas atrasam uma rodada |
| Webhook indisponível | 3 retries backoff via `callWithRetry`; falha final logada | Nada; inbox in-app continua fonte da verdade |
| Janela maior que histórico | Relatório marca `partialHistory: true` | UI exibe aviso "histórico disponível desde X" |
| Sem pedidos p/ média diária | `computeRunwayDays → null` | Corpo do alerta omite runway |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| ------- | -------------------- | ------ | ---------- |
| Receita Shopee é `null` em DailyMetric (pinado no sync) | `src/lib/connectors/shopee-ads/sync.ts:66` | Regra de conta não pode ler revenue de DailyMetric | Parear spend (DailyMetric) × receita (EcommerceOrder) como faz `general-overview.ts` |
| Fuso/hora de corte: `daysAgo` usa UTC do servidor | `src/lib/notifications/rules.ts:37` | Janela com lag 72h precisa cortar por timestamp, não por date | `computeLaggedWindows` opera com timestamps; filtro `createdAt >= corte` nos pedidos |
| `groupBy` não filtra condicional por data no mesmo agregado | `src/lib/notifications/rules.ts:63` | Duas queries por regra (padrão aceito hoje) | Replicar padrão; índices `[workspaceId, source, date]` já existem |
| Cobertura atual dos testes de regras foca campanha | `tests/unit/notification-rules.test.ts` | Novos ramos podem ficar descobertos | Cada task leva seus testes 1:1 com os ACs |

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Onde mora o lag de atribuição | Função pura com constante exportada (`ATTRIBUTION_LAG_HOURS = 72`) | Testável e ajustável sem tocar regra |
| Dedup do alerta de conta | Reusa cooldown por `type + entityId` | Zero código novo; advisory lock herdado |
| Disparo dos canais externos | Fire-and-forget após commit de `persistDrafts`, fora do lock | Não estende transação nem derruba sync |
