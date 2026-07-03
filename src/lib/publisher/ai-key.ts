import { prisma } from "@/lib/db/prisma";
import { getSecretStore } from "@/lib/security/secret-store";

/** Nome namespaced do segredo da chave de IA do workspace (convenção Vault). */
function aiKeySecretName(workspaceId: string): string {
  return `w3ads:${workspaceId}:ai:gemini:apikey`;
}

/**
 * Resolve a chave Gemini a usar para um workspace: a chave BYOK do próprio
 * workspace (Vault) quando cadastrada, senão a chave global de ambiente
 * (GEMINI_API_KEY). Retorna null se nenhuma existir — o caller mostra erro
 * amigável pedindo pra configurar em Configurações.
 */
export async function resolveAiKey(workspaceId: string): Promise<string | null> {
  const config = await prisma.workspaceAiConfig.findUnique({
    where: { workspaceId },
    select: { keySecretId: true },
  });
  if (config?.keySecretId) {
    try {
      const key = await getSecretStore().getSecret(config.keySecretId);
      if (key?.trim()) return key.trim();
    } catch {
      // Segredo ilegível (rotacionado/removido) → cai no fallback global.
    }
  }
  const envKey = process.env.GEMINI_API_KEY?.trim();
  return envKey || null;
}

/** true quando o workspace tem chave BYOK própria cadastrada (pra UI). */
export async function hasWorkspaceAiKey(workspaceId: string): Promise<boolean> {
  const config = await prisma.workspaceAiConfig.findUnique({
    where: { workspaceId },
    select: { keySecretId: true },
  });
  return Boolean(config?.keySecretId);
}

/** Grava/atualiza a chave BYOK do workspace no Vault + WorkspaceAiConfig. */
export async function saveWorkspaceAiKey(input: {
  workspaceId: string;
  apiKey: string;
}): Promise<void> {
  const store = getSecretStore();
  const existing = await prisma.workspaceAiConfig.findUnique({
    where: { workspaceId: input.workspaceId },
    select: { keySecretId: true },
  });

  const secretName = aiKeySecretName(input.workspaceId);
  let keySecretId: string;
  if (existing?.keySecretId) {
    await store.updateSecret(existing.keySecretId, {
      name: secretName,
      value: input.apiKey,
    });
    keySecretId = existing.keySecretId;
  } else {
    keySecretId = await store.createSecret({
      name: secretName,
      value: input.apiKey,
    });
  }

  await prisma.workspaceAiConfig.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      provider: "gemini",
      keySecretId,
    },
    update: { keySecretId },
  });
}

/** Remove a chave BYOK do workspace (volta pro fallback global). */
export async function clearWorkspaceAiKey(workspaceId: string): Promise<void> {
  const existing = await prisma.workspaceAiConfig.findUnique({
    where: { workspaceId },
    select: { keySecretId: true },
  });
  if (existing?.keySecretId) {
    try {
      await getSecretStore().deleteSecret(existing.keySecretId);
    } catch {
      // Vault já sem o segredo — segue limpando o ponteiro.
    }
  }
  await prisma.workspaceAiConfig.updateMany({
    where: { workspaceId },
    data: { keySecretId: null },
  });
}
