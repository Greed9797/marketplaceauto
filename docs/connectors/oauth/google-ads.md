# Google Ads

> Categoria: **Ads** · Modo: **OAuth** · Suporta seleção de contas: **sim** · Janela de backfill: **90 dias**

---

## O que esse conector traz pro dashboard

- Spend de Google Ads (Search, Display, Shopping, Performance Max, YouTube)
- Impressões, cliques, conversões, CPA, ROAS, CTR por campanha
- Tabela "Campanhas Google Ads"
- Combinado com GA4: custo por sessão, taxa de conversão

Tabelas: `DailyMetric` (source=`GOOGLE_ADS`), `CampaignMetadata`.

---

## Antes de começar

- [ ] Master ou Gestor de Contas no W3ADS.
- [ ] Conta Google com acesso a Manager Account (MCC) ou conta de anúncio individual.
- [ ] Acesso a https://console.cloud.google.com.
- [ ] Developer token aprovado pela Google Ads API. **Atenção**: tokens novos vêm como "Test Account" — só funcionam em contas de teste. Pra produção, precisa solicitar nível "Basic" ou "Standard".

---

## 1. Setup no Google Cloud + Google Ads API Center

### 1a. OAuth credentials (Cloud Console)

1. Acesse https://console.cloud.google.com → crie um projeto (ou use existente).
2. **APIs & Services → Library** → habilite **Google Ads API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: `W3ADS Connector`
   - Authorized domains: domínio do `NEXTAUTH_URL` (sem protocolo)
   - Scopes: pode deixar vazio (não-sensíveis); a app pede o scope no runtime
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs:
     ```
     {NEXTAUTH_URL}/api/connectors/google-ads/callback
     ```
5. Copie **Client ID** e **Client Secret**.

### 1b. Developer Token (Google Ads API Center)

1. Vá pra https://ads.google.com (logado com o admin do MCC).
2. **Tools & Settings → Setup → API Center**.
3. Preencha o formulário **Apply for Token Access**. Solicite **Basic Access** se for usar em prod.
4. Anote o **Developer Token** (formato `XYZ123abcDEF456`).
5. Enquanto não aprovado pra Basic, ele só funciona em test accounts (Manager Account marcada como "Test Account").

### 1c. Manager Account (MCC) — opcional mas recomendado

Se você gerencia várias contas, use um MCC. Anote o **Customer ID** do MCC sem hífens (ex: `1234567890`). Esse vai pro campo `loginCustomerId`.

---

## 2. Configurar ProviderConfig no W3ADS

`/connectors/settings/google_ads`:

| Campo | Valor |
|---|---|
| Client ID | (do Cloud Console) |
| Client Secret | (do Cloud Console — vai pro vault) |
| Developer Token | (do Google Ads API Center — vai pro vault) |
| Login Customer ID | ID do MCC sem hífens, ou em branco |
| Redirect URI | `{NEXTAUTH_URL}/api/connectors/google-ads/callback` |
| API Version | `v24` (default, ver [src/lib/connectors/google-ads/oauth.ts](../../../src/lib/connectors/google-ads/oauth.ts)) |
| Scopes | `https://www.googleapis.com/auth/adwords` (default) |
| Status | `ACTIVE` |

**Validar** → **Salvar**.

---

## 3. Conectar uma conta Google Ads

1. `/connectors` → card Google Ads → **Conectar Google**.
2. Redirect pra `accounts.google.com/o/oauth2/v2/auth`.
3. Escolha a conta Google com acesso ao MCC.
4. Autorize permissão `adwords`.
5. Callback retorna; W3ADS chama `customers:listAccessibleCustomers` no Google Ads API pra listar contas.
6. `/connectors/select?session=<id>` → marca quais customers vincular → **Confirmar**.
7. Evento Inngest `connector.google_ads.backfill` disparado.

---

## 4. Sincronização

- **Backfill**: 90 dias de daily metrics por campanha/ad group/keyword.
- **Sync diário**: 03:00 UTC.
- **Refresh token**: Google emite `refresh_token` perpétuo. Quando access_token expira (60min), W3ADS troca automaticamente.

Forçar re-sync: botão na conta.

---

## 5. Verificar dados

1. `/dashboard?period=month` → KPI "Valor investido" agrega Google + Meta.
2. Tabela **Campanhas Google Ads** lista por nome.
3. Query:
   ```sql
   SELECT date, campaign_name, spend, impressions, clicks, conversions
   FROM "DailyMetric" dm
   JOIN "CampaignMetadata" cm ON cm.id = dm."campaignMetadataId"
   WHERE dm.source = 'GOOGLE_ADS' AND dm."workspaceId" = '<id>'
   ORDER BY date DESC, spend DESC LIMIT 50;
   ```

---

## Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `?error=missing-provider-config` | Falta cadastrar app | `/connectors/settings/google_ads` |
| `?error=google-ads-api` | Developer token inválido ou ainda em "test access" + tentando conta produtiva | Confirmar token aprovado em ads.google.com → API Center |
| `?error=invalid-state` | Cookie OAuth expirou | Refazer |
| Listagem de contas vazia | OAuth ok mas usuário não tem acesso a MCC nem a contas individuais | Confirmar permissão no Google Ads UI |
| `INVALID_LOGIN_CUSTOMER_ID` | `loginCustomerId` com hífens ou de conta sem permissão sobre as outras | Remover hífens; usar MCC válido |
| Dashboard sem dados após connect | Inngest sem `INNGEST_EVENT_KEY` | Configurar env |

---

## Referências de código

- OAuth URL: [src/lib/connectors/google-ads/oauth.ts](../../../src/lib/connectors/google-ads/oauth.ts)
- Connect: [src/app/api/connectors/google-ads/connect/route.ts](../../../src/app/api/connectors/google-ads/connect/route.ts)
- Callback: [src/app/api/connectors/google-ads/callback/route.ts](../../../src/app/api/connectors/google-ads/callback/route.ts)
- Client: [src/lib/connectors/google-ads/client.ts](../../../src/lib/connectors/google-ads/client.ts)
- Sync: [src/lib/connectors/google-ads/sync.ts](../../../src/lib/connectors/google-ads/sync.ts)
- Validation: [src/lib/connectors/provider-config.ts](../../../src/lib/connectors/provider-config.ts)
