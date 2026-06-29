# Matriz de Permissões — Conectores

Fonte autoritativa: [src/lib/auth/platform-permissions.ts](../../../src/lib/auth/platform-permissions.ts).

---

## Por papel (Platform Role)

| Capability | Master (`ADMIN_MASTER`) | Gestor de Contas (`ADMIN_LIMITED`) | Gestor de Tráfego (`TRAFFIC_MANAGER`) | Cliente (`USER` + Membership `CLIENT`) |
|---|:---:|:---:|:---:|:---:|
| Acessar `/connectors` | ✅ | ✅ | ❌ | ✅ |
| Acessar `/connectors/settings/<provider>` (CRUD de apps) | ✅ | ✅ | ❌ | ❌ |
| Cadastrar/editar `ProviderConfig` | ✅ | ✅ | ❌ | ❌ |
| Deletar `ProviderConfig` | ✅ | ✅ | ❌ | ❌ |
| Iniciar OAuth (conectar conta) | ✅ | ✅ | ❌ | ✅ |
| Submeter conector manual | ✅ | ✅ | ❌ | ✅ |
| Deletar `ConnectorAccount` | ✅ | ✅ | ❌ | ❌ |
| Forçar re-sync de uma conta | ✅ | ✅ | ❌ | ❌ |
| Criar usuários `ADMIN_MASTER` ou `ADMIN_LIMITED` | ✅ | ❌ | ❌ | ❌ |
| Criar usuários `TRAFFIC_MANAGER` ou `USER` | ✅ | ✅ | ❌ | ❌ |
| Ver dashboard | ✅ | ✅ | ✅ | ✅ |

---

## Funções TypeScript que aplicam essas regras

| Função | Retorno | Onde checa |
|---|---|---|
| `isAdminMaster(user)` | true se ADMIN_MASTER ou W3_ADMIN | base de outras checagens |
| `canManageProviderConfigs(user)` | Master + Gestor Contas | server actions de `/connectors/settings` |
| `canAddWorkspaceConnectors(user, role)` | Master, Gestor Contas, OWNER, ADMIN, CLIENT | rotas `/api/connectors/<provider>/connect`, formulário manual |
| `canDeleteWorkspaceConnectors(user, role)` | Master, Gestor Contas, OWNER, ADMIN. Sem CLIENT. | rotas de delete |
| `canDeleteData(user, role)` | gate geral; Tráfego sempre negado | qualquer operação destrutiva |
| `canManageAdminUsers(user)` | só Master | `/platform/users` ao criar admins |
| `canAssignPlatformRole(actor, target)` | Master atribui qualquer papel; Gestor Contas atribui só TRAFFIC_MANAGER e USER | formulário de criação de usuário |

---

## Como Gestor de Tráfego é tratado

A regra de negócio é que esse papel só consome relatórios — nunca toca em conectores ou em dados. Implementação:

```ts
// src/lib/auth/platform-permissions.ts
export function canAddWorkspaceConnectors(user, role) {
  if (isAdminMaster(user) || isAdminLimited(user)) return true;
  if (isTrafficManager(user)) return false;          // <- bloqueio explícito
  return role === "OWNER" || role === "ADMIN" || role === "CLIENT";
}
```

Resultado prático:
- Sidebar do Gestor de Tráfego **não mostra** o item "Conectores".
- Rotas `/connectors*` redirecionam ele de volta pro dashboard.

---

## Como CLIENT é tratado

Cliente é tipicamente o dono da marca/loja. Quer conseguir adicionar a própria loja Shopify ou planilha sem precisar pedir pro W3, mas não deve apagar contas já vinculadas — isso fica como gate humano.

```ts
export function canDeleteWorkspaceConnectors(user, role) {
  if (isAdminMaster(user) || isAdminLimited(user)) return true;
  if (isTrafficManager(user)) return false;
  return role === "OWNER" || role === "ADMIN";   // CLIENT cai aqui
}
```

UI: botões de "Remover conta" simplesmente não aparecem pra CLIENT.

---

## Testes

A cobertura mínima desses contratos vive em [tests/unit/platform-admin.test.ts](../../../tests/unit/platform-admin.test.ts). Rode com:

```bash
npx vitest run tests/unit/platform-admin.test.ts
```
