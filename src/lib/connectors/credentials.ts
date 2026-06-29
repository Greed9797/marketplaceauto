import { createHash } from "node:crypto";

import {
  decryptToken,
  decryptTokenEnvelope,
  encryptToken,
  type EncryptedToken,
} from "@/lib/crypto/token-vault";
import { getSecretStore, type SecretStore } from "@/lib/security/secret-store";

export type ConnectorCredentialValue =
  | string
  | number
  | boolean
  | null
  | undefined;
export type ConnectorCredentialPayload = Record<
  string,
  ConnectorCredentialValue
>;

export function encryptConnectorCredentials(
  credentials: ConnectorCredentialPayload,
  options: { key?: string; keyVersion?: string } = {},
) {
  return encryptToken(JSON.stringify(credentials), options);
}

export function decryptConnectorCredentials(
  encrypted: EncryptedToken,
  options: { key?: string; keyVersion?: string } = {},
) {
  return JSON.parse(
    decryptToken(encrypted, options),
  ) as ConnectorCredentialPayload;
}

export function connectorCredentialsFromAccount(account: {
  accessTokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  tokenKeyVersion: string;
}) {
  return decryptConnectorCredentials({
    ciphertext: account.accessTokenCiphertext,
    iv: account.tokenIv,
    authTag: account.tokenAuthTag,
    keyVersion: account.tokenKeyVersion,
  });
}

function parseCredentialSecret(value: string): ConnectorCredentialPayload {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ConnectorCredentialPayload;
    }
  } catch {
    return { accessToken: value };
  }

  return { accessToken: value };
}

export class CredentialUnavailableError extends Error {
  readonly code: "vault_unavailable" | "no_credentials";
  constructor(message: string, code: "vault_unavailable" | "no_credentials") {
    super(message);
    this.name = "CredentialUnavailableError";
    this.code = code;
  }
}

function hasInlineCredentials(account: {
  accessTokenCiphertext: string;
  tokenIv: string;
}): boolean {
  return (
    account.tokenIv !== "vault" && account.accessTokenCiphertext !== "vault"
  );
}

export async function connectorCredentialsFromAccountVaultAware(
  account: {
    credentialSecretId?: string | null;
    accessTokenCiphertext: string;
    tokenIv: string;
    tokenAuthTag: string;
    tokenKeyVersion: string;
  },
  store: SecretStore = getSecretStore(),
) {
  if (account.credentialSecretId) {
    try {
      return parseCredentialSecret(
        await store.getSecret(account.credentialSecretId),
      );
    } catch (caught) {
      if (hasInlineCredentials(account)) {
        return connectorCredentialsFromAccount(account);
      }
      const message =
        caught instanceof Error
          ? `Vault credential unavailable: ${caught.message}`
          : "Vault credential unavailable";
      throw new CredentialUnavailableError(message, "vault_unavailable");
    }
  }

  if (!hasInlineCredentials(account)) {
    throw new CredentialUnavailableError(
      "Credentials missing: no vault secret and no inline ciphertext",
      "no_credentials",
    );
  }

  return connectorCredentialsFromAccount(account);
}

export async function connectorAccessTokenFromAccount(
  account: {
    credentialSecretId?: string | null;
    accessTokenCiphertext: string;
    tokenIv: string;
    tokenAuthTag: string;
    tokenKeyVersion: string;
  },
  store: SecretStore = getSecretStore(),
) {
  const credentials = await connectorCredentialsFromAccountVaultAware(
    account,
    store,
  );
  const accessToken = credentials.accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Connector access token is missing");
  }

  return accessToken;
}

export async function connectorRefreshTokenFromAccount(
  account: {
    refreshCredentialSecretId?: string | null;
    refreshTokenCiphertext?: string | null;
  },
  store: SecretStore = getSecretStore(),
) {
  if (account.refreshCredentialSecretId) {
    return store.getSecret(account.refreshCredentialSecretId);
  }
  if (account.refreshTokenCiphertext) {
    return decryptTokenEnvelope(account.refreshTokenCiphertext);
  }

  return null;
}

export async function vaultCredentialFields(input: {
  workspaceId: string;
  provider: string;
  externalAccountId: string;
  credentials: ConnectorCredentialPayload;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  store?: SecretStore;
}) {
  const store = input.store ?? getSecretStore();
  const credentialSecretId = await store.createSecret({
    name: `w3ads:${input.workspaceId}:${input.provider}:${input.externalAccountId}:credentials`,
    value: JSON.stringify(input.credentials),
  });
  const refreshCredentialSecretId = input.refreshToken
    ? await store.createSecret({
        name: `w3ads:${input.workspaceId}:${input.provider}:${input.externalAccountId}:refresh`,
        value: input.refreshToken,
      })
    : null;

  return {
    accessTokenCiphertext: "vault",
    refreshTokenCiphertext: null,
    tokenIv: "vault",
    tokenAuthTag: "vault",
    tokenKeyVersion: "vault",
    credentialSecretId,
    refreshCredentialSecretId,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
  };
}

export function stableExternalAccountId(provider: string, accountSeed: string) {
  return createHash("sha256")
    .update(`${provider}:${accountSeed.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}
