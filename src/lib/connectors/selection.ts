import { ConnectorProvider, ConnectorStatus, Prisma } from "@prisma/client";

import {
  decryptConnectorCredentials,
  vaultCredentialFields,
  type ConnectorCredentialPayload,
} from "@/lib/connectors/credentials";
import { encryptToken, encryptTokenEnvelope, type EncryptedToken } from "@/lib/crypto/token-vault";
import { prisma } from "@/lib/db/prisma";
import { getSecretStore, type SecretStore } from "@/lib/security/secret-store";

export type ConnectorSelectableAccount = {
  externalAccountId: string;
  accountName: string;
  metadata?: Prisma.InputJsonValue;
};

export type ConnectorSelectionCredentials = ConnectorCredentialPayload & {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
};

export type ConnectorSelectionSessionPayload = {
  accounts: ConnectorSelectableAccount[];
  credentials: ConnectorSelectionCredentials;
};

export function parseSelectableAccounts(value: unknown): ConnectorSelectableAccount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((account) => {
    if (!account || typeof account !== "object") {
      return [];
    }

    const record = account as Record<string, unknown>;
    const externalAccountId = record.externalAccountId;
    const accountName = record.accountName;

    if (typeof externalAccountId !== "string" || typeof accountName !== "string") {
      return [];
    }

    return [
      {
        externalAccountId,
        accountName,
        metadata: record.metadata as Prisma.InputJsonValue,
      },
    ];
  });
}

export function buildSelectedConnectorAccounts(input: {
  workspaceId: string;
  provider: ConnectorProvider;
  accounts: ConnectorSelectableAccount[];
  selectedExternalAccountIds: string[];
  encryptedCredentials: EncryptedToken;
  refreshTokenCiphertext?: string | null;
  tokenExpiresAt?: Date | null;
}) {
  const byId = new Map(input.accounts.map((account) => [account.externalAccountId, account]));
  const selected = input.selectedExternalAccountIds.map((id) => {
    const account = byId.get(id);
    if (!account) {
      throw new Error("Selected connector account was not found");
    }

    return account;
  });

  return selected.map((account) => ({
    workspaceId: input.workspaceId,
    provider: input.provider,
    externalAccountId: account.externalAccountId,
    accountName: account.accountName,
    status: ConnectorStatus.ACTIVE,
    accessTokenCiphertext: input.encryptedCredentials.ciphertext,
    refreshTokenCiphertext: input.refreshTokenCiphertext ?? null,
    tokenIv: input.encryptedCredentials.iv,
    tokenAuthTag: input.encryptedCredentials.authTag,
    tokenKeyVersion: input.encryptedCredentials.keyVersion,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    metadata: account.metadata ?? Prisma.JsonNull,
    lastSyncError: null,
  }));
}

export async function createConnectorSelectionSession(input: {
  workspaceId: string;
  userId: string;
  provider: ConnectorProvider;
  accounts: ConnectorSelectableAccount[];
  credentials: ConnectorSelectionCredentials;
  expiresAt?: Date;
  store?: SecretStore;
}) {
  const store = input.store ?? getSecretStore();
  const credentialSecretId = await store.createSecret({
    name: `w3ads:${input.workspaceId}:${input.provider}:${input.userId}:selection`,
    value: JSON.stringify(input.credentials),
  });

  return prisma.connectorSelectionSession.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      accounts: input.accounts as unknown as Prisma.InputJsonValue,
      credentialCiphertext: "vault",
      credentialIv: "vault",
      credentialAuthTag: "vault",
      credentialKeyVersion: "vault",
      credentialSecretId,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
    },
  });
}

export async function loadSelectionCredentials(
  session: {
    credentialSecretId?: string | null;
    credentialCiphertext: string;
    credentialIv: string;
    credentialAuthTag: string;
    credentialKeyVersion: string;
  },
  store: SecretStore = getSecretStore(),
) {
  if (session.credentialSecretId) {
    return JSON.parse(await store.getSecret(session.credentialSecretId)) as ConnectorSelectionCredentials;
  }

  return decryptSelectionCredentials(session);
}

export function decryptSelectionCredentials(session: {
  credentialCiphertext: string;
  credentialIv: string;
  credentialAuthTag: string;
  credentialKeyVersion: string;
}) {
  return decryptConnectorCredentials({
    ciphertext: session.credentialCiphertext,
    iv: session.credentialIv,
    authTag: session.credentialAuthTag,
    keyVersion: session.credentialKeyVersion,
  }) as ConnectorSelectionCredentials;
}

export function encryptSelectedAccountCredentials(credentials: ConnectorSelectionCredentials) {
  const accessToken =
    typeof credentials.accessToken === "string" ? credentials.accessToken : JSON.stringify(credentials);

  return {
    encryptedAccessToken: encryptToken(accessToken),
    encryptedRefreshToken:
      typeof credentials.refreshToken === "string"
        ? encryptTokenEnvelope(credentials.refreshToken)
        : null,
    tokenExpiresAt:
      typeof credentials.tokenExpiresAt === "string" ? new Date(credentials.tokenExpiresAt) : null,
  };
}

export async function vaultSelectedAccountCredentials(input: {
  workspaceId: string;
  provider: ConnectorProvider;
  externalAccountId: string;
  credentials: ConnectorSelectionCredentials;
  store?: SecretStore;
}) {
  const { refreshToken, tokenExpiresAt, ...credentialPayload } = input.credentials;

  return vaultCredentialFields({
    workspaceId: input.workspaceId,
    provider: input.provider,
    externalAccountId: input.externalAccountId,
    credentials: credentialPayload,
    refreshToken: typeof refreshToken === "string" ? refreshToken : null,
    tokenExpiresAt: typeof tokenExpiresAt === "string" ? new Date(tokenExpiresAt) : null,
    store: input.store,
  });
}
