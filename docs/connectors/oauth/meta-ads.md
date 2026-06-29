# Meta Ads (Facebook / Instagram)

> Categoria: **Ads** · Modo: **OAuth** · Suporta seleção de contas: **sim** · Janela de backfill: **90 dias**

---

## O que esse conector traz pro dashboard

- KPI "Valor investido" e "Custo de mídia" — ads spend Meta
- ROAS Meta (revenue atribuído ÷ spend)
- Tabela "Campanhas Meta Ads" no dashboard (impressões, cliques, conversões, CPA, CTR)
- Custo por sessão / taxa de conversão quando combinado com GA4

Tabelas afetadas: `DailyMetric` (source=`META_ADS`), tabela de campanhas via `CampaignMetadata`.

---

## Antes de começar

- [ ] Você é Master ou Gestor de Contas do W3ADS.
- [ ] Tem acesso de admin a um **Business Manager** do Meta com pelo menos uma conta de anúncios ativa.
- [ ] Tem conta de desenvolvedor em https://developers.facebook.com.
- [ ] Sabe qual o `NEXTAUTH_URL` da sua instância W3ADS (ex: `https://app.w3ads.com.br` em prod ou `http://localhost:3000` em dev).

---

## 1. Setup no Meta for Developers

1. Acesse https://developers.facebook.com → **My Apps** → **Create App**.
2. Tipo de app: **Business**. Nome sugerido: `W3ADS Connector`.
3. Em **App Dashboard**, copie:
   - **App ID** (público)
   - **App Secret** → clique em "Show" e copie
4. **Add Product → Facebook Login**:
   - Settings → **Valid OAuth Redirect URIs**:
     ```
     {NEXTAUTH_URL}/api/connectors/meta/callback
     ```
     Em produção: `https://app.w3ads.com.br/api/connectors/meta/callback`
5. **Add Product → Marketing API** (necessário pra ler dados de anúncio).
6. **App Review → Permissions and Features**:
   - Solicite review pra: `ads_read`, `ads_management`, `business_management`, `read_insights`.
   - Enquanto o app estiver em modo Development, só admins/devs adicionados ao app podem testar.
7. **Settings → Basic**:
   - Adicione um **Privacy Policy URL** (obrigatório pra sair do dev mode).
   - **App Domains**: domínio do `NEXTAUTH_URL` sem o protocolo.

> Dica: enquanto não passar review, adicione os usuários internos como "Roles → Testers" pra eles poderem autorizar.

---

## 2. Configurar ProviderConfig no W3ADS

Acesse `/connectors/settings/meta_ads`:

| Campo | Valor |
|---|---|
| App ID | (copiado do Meta) |
| App Secret | (copiado do Meta — vai pro vault) |
| Redirect URI | `{NEXTAUTH_URL}/api/connectors/meta/callback` |
| API Version | `v25.0` (default, ver [src/lib/connectors/meta/oauth.ts](../../../src/lib/connectors/meta/oauth.ts)) |
| Scopes | `ads_read,ads_management,business_management,read_insights` (default) |
| Status | `ACTIVE` |

Clique **Validar** (testa se App ID + Secret são aceitos pelo endpoint do Meta) → **Salvar**.

Comportamento esperado: redirect pra `/connectors/settings/meta_ads?saved=1`.

---

## 3. Conectar uma conta Meta

1. Em `/connectors`, encontre o card "Meta Ads" → clique **Conectar Meta**.
2. Você é redirecionado pra `facebook.com/v25.0/dialog/oauth?...`.
3. Selecione o Business Manager → autorize as permissões.
4. Meta redireciona de volta pra `/api/connectors/meta/callback?code=...&state=...`.
5. Server troca o code por `access_token` (long-lived, ~60 dias) + lista de contas de anúncio.
6. Você cai em `/connectors/select?session=<id>` → marca quais contas vincular → **Confirmar**.
7. Cada conta vira um `ConnectorAccount` ACTIVE. Evento Inngest `connector.meta.backfill` é emitido.

Em caso de "Provider Denied" significa que o usuário negou alguma permissão. Volte e refaça.

---

## 4. Sincronização

- **Backfill inicial**: 90 dias de daily insights por campaign/adset/ad. Disparado automaticamente no connect.
- **Sync diário**: à 00:10 UTC, pega últimos 7 dias (corrige conversões tardias).
- **Token refresh**: long-lived token Meta dura 60d. Hoje é manual — quando faltar < 7d, reconecte (próxima feature: auto-rotação).

Onde acompanhar:
- `ConnectorAccount.lastSyncedAt` — última execução com sucesso
- `ConnectorAccount.lastSyncError` — última mensagem de erro (se houver)
- `SyncJob` no DB — histórico de execuções

Forçar re-sync manual: no card da conta em `/connectors`, botão "Sincronizar agora" (Master/Gestor Contas only).

---

## 5. Verificar dados no dashboard

1. Vá pra `/dashboard?period=month`.
2. KPI **Valor investido** deve refletir o spend dos últimos 30d.
3. Tabela **Campanhas Meta Ads** lista por nome de campanha. Clique pra ver detalhamento.
4. Query SQL útil:
   ```sql
   SELECT date, spend, impressions, clicks, conversions
   FROM "DailyMetric"
   WHERE "workspaceId" = '<id>' AND source = 'META_ADS'
   ORDER BY date DESC LIMIT 30;
   ```

---

## Troubleshooting

| Erro na URL | Causa | Solução |
|---|---|---|
| `?error=invalid-state` | Cookie de state expirou (>10min entre clicar Conectar e voltar do Meta) | Tente conectar de novo |
| `?error=missing-code` | Meta não devolveu `code` (geralmente usuário fechou o popup) | Refazer fluxo |
| `?error=missing-provider-config` | Master ainda não cadastrou App ID/Secret | Ir em `/connectors/settings/meta_ads` |
| `?error=meta-api` | App está em dev mode e usuário não é tester, ou developer token incorreto | Adicionar usuário como Tester no Meta App |
| `?error=provider-denied` | Usuário negou permissões na tela do Meta | Refazer e aceitar todas |
| Dashboard sem dados | `INNGEST_EVENT_KEY` ausente em prod | Conferir env, ver [reference/env-vars.md](../reference/env-vars.md) |
| "Backfill stuck" | Token long-lived expirado (>60d) | Reconectar a conta |

---

## Referências de código

- OAuth URL builder: [src/lib/connectors/meta/oauth.ts](../../../src/lib/connectors/meta/oauth.ts)
- Connect: [src/app/api/connectors/meta/connect/route.ts](../../../src/app/api/connectors/meta/connect/route.ts)
- Callback: [src/app/api/connectors/meta/callback/route.ts](../../../src/app/api/connectors/meta/callback/route.ts)
- Client API: [src/lib/connectors/meta/client.ts](../../../src/lib/connectors/meta/client.ts)
- Sync function: [src/lib/connectors/meta/sync.ts](../../../src/lib/connectors/meta/sync.ts)
- Form UI: [src/app/(app)/connectors/settings/[provider]/page.tsx](../../../src/app/(app)/connectors/settings/[provider]/page.tsx)
- Validation: [src/lib/connectors/provider-config.ts](../../../src/lib/connectors/provider-config.ts)
