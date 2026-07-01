import { encryptToken, encryptTokenEnvelope } from "@/lib/crypto/token-vault";

/**
 * Encrypted-token column shape shared with the `ClienteConnection` model. The
 * access token uses the split AES-256-GCM envelope (ciphertext + iv + authTag +
 * keyVersion), exactly like `ConnectorAccount`. The refresh token is stored as a
 * self-contained JSON envelope in a single column (decrypt with
 * `decryptTokenEnvelope`).
 */
export type ClienteTokenFields = {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  tokenIv: string;
  tokenAuthTag: string;
  tokenKeyVersion: string;
};

/**
 * Encrypts a marketplace access/refresh token pair for persistence on a
 * `ClienteConnection`. Reuses the same `TOKEN_ENCRYPTION_KEY` AES-256-GCM vault
 * as the connector credentials so no new key material is introduced.
 */
export function encryptClienteTokens(input: {
  accessToken: string;
  refreshToken?: string | null;
}): ClienteTokenFields {
  const encrypted = encryptToken(input.accessToken);

  return {
    accessTokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    tokenKeyVersion: encrypted.keyVersion,
    refreshTokenCiphertext: input.refreshToken
      ? encryptTokenEnvelope(input.refreshToken)
      : null,
  };
}
