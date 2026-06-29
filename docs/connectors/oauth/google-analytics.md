# Google Analytics 4 (GA4)

> Categoria: **Analytics** · Modo: **OAuth** · Suporta seleção de propriedades: **sim** · Janela de backfill: **90 dias**

---

## O que esse conector traz pro dashboard

- Sessões, usuários, pageviews por dia
- Taxa de conversão de e-commerce (purchase events)
- Custo por sessão (combinando com Ads)
- Funil: sessions → add_to_cart → checkout → purchase

Tabelas: `DailyMetric` (source=`GA4`), `addToCart` field populado.

---

## Antes de começar

- [ ] Master ou Gestor de Contas no W3ADS.
- [ ] Conta Google com acesso ao **GA4 Property** que vai conectar.
- [ ] OAuth credentials no Google Cloud Console (pode ser o **mesmo projeto** usado em Google Ads — só precisa habilitar a Analytics Data API adicional).

---

## 1. Setup no Google Cloud Console

1. https://console.cloud.google.com → seu projeto.
2. **APIs & Services → Library** → habilite:
   - **Google Analytics Data API** (GA4)
   - **Google Analytics Admin API**
3. **OAuth consent screen**: scopes não-sensíveis bastam (a app pede `analytics.readonly` no runtime).
4. **Credentials → Create OAuth client ID**:
   - Web application
   - Authorized redirect URIs:
     ```
     {NEXTAUTH_URL}/api/connectors/google-analytics/callback
     ```
5. Copie **Client ID** e **Client Secret**.

> Se já tem credenciais de Google Ads, pode **criar um novo OAuth client** no mesmo projeto pra evitar conflitar consent screens, ou reutilizar adicionando o redirect URI do GA4 às URIs autorizadas.

---

## 2. Configurar ProviderConfig

`/connectors/settings/ga4`:

| Campo | Valor |
|---|---|
| Client ID | (do Cloud Console) |
| Client Secret | (do Cloud Console — vai pro vault) |
| Redirect URI | `{NEXTAUTH_URL}/api/connectors/google-analytics/callback` |
| Scopes | `https://www.googleapis.com/auth/analytics.readonly` (default) |
| Status | `ACTIVE` |

**Validar** → **Salvar**.

---

## 3. Conectar uma propriedade GA4

1. `/connectors` → card Google Analytics → **Conectar Analytics**.
2. Autorize permissão `analytics.readonly`.
3. Callback → W3ADS chama `accountSummaries.list` pra enumerar propriedades acessíveis.
4. `/connectors/select?session=<id>` → escolha as Properties GA4 a vincular → **Confirmar**.
5. Evento Inngest `connector.google_analytics.backfill` emitido.

> Você precisa ter pelo menos **Viewer** role na Property em https://analytics.google.com → Admin → Property Access Management.

---

## 4. Sincronização

- **Backfill**: 90 dias de daily metrics (sessions, users, conversions, events de e-commerce).
- **Sync diário**: 03:30 UTC.
- **Refresh token**: emitido junto com access token; W3ADS rotaciona automaticamente.

---

## 5. Verificar dados

1. `/dashboard` → KPIs **Sessões** e **Taxa de conversão**.
2. Query:
   ```sql
   SELECT date, sessions, users, conversions, "addToCart", revenue
   FROM "DailyMetric"
   WHERE source = 'GA4' AND "workspaceId" = '<id>'
   ORDER BY date DESC LIMIT 30;
   ```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=google-analytics-api` | API não habilitada no Cloud project | Habilitar Google Analytics Data API + Admin API |
| `?error=missing-provider-config` | Client ID/Secret não cadastrados | `/connectors/settings/ga4` |
| Listagem de propriedades vazia | Usuário não tem acesso a nenhuma Property | Adicionar permissão Viewer em GA4 Admin |
| Sessões zeradas após sync | Property foi um Universal Analytics (UA), não GA4 | UA está deprecated; só GA4 é suportado |
| Dados defasados >24h | Sync diário falhou | Conferir `lastSyncError` no `ConnectorAccount` |

---

## Referências de código

- OAuth: [src/lib/connectors/google-analytics/oauth.ts](../../../src/lib/connectors/google-analytics/oauth.ts)
- Connect: [src/app/api/connectors/google-analytics/connect/route.ts](../../../src/app/api/connectors/google-analytics/connect/route.ts)
- Callback: [src/app/api/connectors/google-analytics/callback/route.ts](../../../src/app/api/connectors/google-analytics/callback/route.ts)
- Client: [src/lib/connectors/google-analytics/client.ts](../../../src/lib/connectors/google-analytics/client.ts)
- Sync: [src/lib/connectors/google-analytics/sync.ts](../../../src/lib/connectors/google-analytics/sync.ts)
