# FAQ & Troubleshooting

Erros comuns em conectores e como diagnosticar.

---

## Tabela de erros por URL

Todo erro de conexão volta com `?error=<code>` na URL `/connectors`. Códigos e fixes:

| Código | Significado | Onde acontece | Fix |
|---|---|---|---|
| `invalid-state` | Cookie de state OAuth ausente/expirado (>10min) | Callback de qualquer OAuth | Refazer o flow desde o botão "Conectar" |
| `missing-code` | Provedor não devolveu `code` | Callback | Geralmente é cancelamento; refaça |
| `missing-provider-config` | Master/Gestor Contas não cadastrou app | Click em "Conectar" | Ir em `/connectors/settings/<provider>` |
| `provider-denied` | Usuário negou permissões | Callback | Refazer e aceitar |
| `meta-api` | Erro genérico da Meta Graph API | Meta callback | Conferir app status (dev/live), permissões |
| `google-ads-api` | Erro da Google Ads API | Google Ads callback | Conferir developer token; ver "Test access" vs "Basic access" |
| `google-analytics-api` | Erro da Analytics Data API | GA4 callback | Habilitar API no Cloud Console |
| `shopify-api` | Erro genérico Shopify | Shopify callback | Conferir scopes, plano da loja |
| `invalid-hmac` | HMAC do callback Shopify não confere | Shopify callback | API Secret cadastrado no W3 ≠ do Partner Dashboard |
| `invalid-shop` | Domínio Shopify inválido | Form connect Shopify | Use `loja.myshopify.com` |
| `missing-shop` | Form Shopify sem campo loja | Connect Shopify | Preencher campo |
| `nuvemshop-api` | Erro da Nuvemshop API | Nuvemshop callback | App marcado como production no Partner |
| `missing-selection` | Usuário não selecionou contas | /connectors/select POST | Selecionar pelo menos uma |
| `selection-expired` | ConnectorSelectionSession >10min | /connectors/select POST | Reconectar |
| `selection-failed` | Erro genérico ao gravar seleção | /connectors/select POST | Ver logs |
| `invalid-manual-connector` | Campos do form manual inválidos | Form manual | Conferir Base URL e API key |
| `manual-credentials` | healthCheck do conector manual falhou (401/403/404) | Form manual | Conferir credenciais; testar com curl |
| `forbidden` | RBAC negou acesso | Qualquer rota | Confirmar papel do usuário (ex: Tráfego não pode acessar conectores) |

---

## Bug histórico: `error=NEXT_REDIRECT;push`

Sintoma: após salvar config, URL fica `?error=NEXT_REDIRECT;push` e nada aparece no DB.

Causa: `redirect()` do Next.js lança internamente `NEXT_REDIRECT` como mecanismo de fluxo. Quando o `redirect()` está dentro de um `try { ... } catch (error) { redirect(error) }`, o catch engole o redirect bem-sucedido e re-redireciona com o "erro" fake.

Fix aplicado em [src/app/(app)/connectors/settings/actions.ts](../../src/app/(app)/connectors/settings/actions.ts) `saveProviderConfigAction`: capturar erro real numa variável, `redirect()` chamado **fora** do try/catch.

**Padrão correto para server actions Next.js**:
```ts
let saveError: string | null = null;
try {
  // operation
} catch (error) {
  saveError = error instanceof Error ? error.message : "Erro";
}
if (saveError) redirect(`...?error=${...}`);
redirect(`...?saved=1`);
```

---

## Dashboard não atualiza após conectar

Checklist em ordem:

1. **`?saved=1` apareceu na URL** depois de salvar config? Se foi `?saved=demo` ou `?error=NEXT_REDIRECT`, ProviderConfig não foi gravado — veja sessão acima.
2. **ConnectorAccount existe no DB?**
   ```sql
   SELECT id, provider, "externalAccountId", status, "lastSyncedAt", "lastSyncError"
   FROM "ConnectorAccount"
   WHERE "workspaceId" = '<id>';
   ```
   Se vazio, OAuth/manual não completou. Refaça.
3. **Inngest está rodando?** Sem dev server ou sem `INNGEST_EVENT_KEY` em prod, eventos `connector.*.backfill` ficam só no console.
4. **SyncJob criado?**
   ```sql
   SELECT id, "connectorAccountId", "syncType", status, "createdAt", "completedAt"
   FROM "SyncJob"
   WHERE "workspaceId" = '<id>'
   ORDER BY "createdAt" DESC LIMIT 10;
   ```
5. **`DailyMetric` / `EcommerceOrder` populados?**
   ```sql
   SELECT source, count(*), max(date) FROM "DailyMetric" GROUP BY source;
   SELECT platform, count(*), max(date) FROM "EcommerceOrder" GROUP BY platform;
   ```

Se SyncJob existe mas FAILED, leia `ConnectorAccount.lastSyncError` — geralmente fala a causa (token expirado, scope insuficiente, rate limit).

---

## Refresh token expirou

| Provider | Duração do token | Renovação |
|---|---|---|
| Meta Ads | long-lived ~60d | Manual hoje. Próxima feature: cron auto-rotate. Reconectar quando faltar <7d. |
| Google Ads / GA4 | refresh perpétuo | Automático no client |
| Shopify | sem expiração (revogável pelo dono) | Reconectar quando dono revoga |
| Nuvemshop | sem expiração | Reconectar quando revoga |
| Manuais | varia por provedor (Tray principalmente) | Regenerar token e atualizar via UI |

---

## Como forçar re-sync manualmente

UI:
1. `/connectors` → encontre a conta
2. Botão "Sincronizar agora" (apenas Master/Gestor Contas)

SQL (avançado):
```sql
-- Marca conta pra próximo sync diário ignorar lastSyncedAt
UPDATE "ConnectorAccount" SET "lastSyncedAt" = NULL WHERE id = '<id>';

-- Cria SyncJob manualmente — não recomendado; melhor disparar evento Inngest
```

Inngest dev:
```bash
npx inngest-cli dev
# disparar evento manualmente em http://localhost:8288 (UI Inngest)
# event name: connector.<provider>.backfill
# payload: { connectorAccountId: "<id>", range: { since, until } }
```

---

## "Webhook não chega" (Shopify)

1. URL pública acessível? Em dev, use `ngrok http 3000` e atualize `NEXTAUTH_URL` + Partner Dashboard.
2. HMAC validado? Conferir `apiSecret` no W3 = Client Secret do Partner Dashboard.
3. Webhook registrado? Conectar uma loja registra automaticamente em `webhooks/orders/create`. Confirme em Shopify admin → Settings → Notifications → Webhooks.

---

## Como rotacionar `TOKEN_ENCRYPTION_KEY` (avançado)

A chave protege `access_token`/`refresh_token` no banco. Trocar significa **invalidar todos os tokens existentes** — usuários precisam reconectar.

Processo:
1. Gere nova chave: `openssl rand -base64 32`.
2. Setar `TOKEN_ENCRYPTION_KEY=<nova>` em prod.
3. Deploy.
4. Comunicar usuários: tokens existentes não decifram mais → reconectar cada conta.

Não há suporte a key rotation transparente (key versioning) hoje; é planned.

---

## Como verificar permissões via SQL

```sql
SELECT u.email, u."platformRole", m.role AS membership_role
FROM "User" u
LEFT JOIN "Membership" m ON m."userId" = u.id
WHERE u.email = '<email>';
```

Cruze com a matriz em [reference/permissions.md](./reference/permissions.md).
