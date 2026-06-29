import { ConnectorProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildSelectedConnectorAccounts,
  type ConnectorSelectableAccount,
} from "@/lib/connectors/selection";

const accounts: ConnectorSelectableAccount[] = [
  {
    externalAccountId: "act_1",
    accountName: "Cliente A",
    metadata: { currency: "BRL" },
  },
  {
    externalAccountId: "act_2",
    accountName: "Cliente B",
    metadata: { currency: "USD" },
  },
];

describe("connector account selection", () => {
  it("persists only explicitly selected external accounts", () => {
    expect(
      buildSelectedConnectorAccounts({
        workspaceId: "workspace-1",
        provider: ConnectorProvider.META_ADS,
        accounts,
        selectedExternalAccountIds: ["act_2"],
        encryptedCredentials: {
          ciphertext: "ciphertext",
          iv: "iv",
          authTag: "tag",
          keyVersion: "v1",
        },
      }),
    ).toEqual([
      {
        workspaceId: "workspace-1",
        provider: ConnectorProvider.META_ADS,
        externalAccountId: "act_2",
        accountName: "Cliente B",
        status: "ACTIVE",
        accessTokenCiphertext: "ciphertext",
        refreshTokenCiphertext: null,
        tokenIv: "iv",
        tokenAuthTag: "tag",
        tokenKeyVersion: "v1",
        tokenExpiresAt: null,
        metadata: { currency: "USD" },
        lastSyncError: null,
      },
    ]);
  });

  it("rejects unknown selected account ids", () => {
    expect(() =>
      buildSelectedConnectorAccounts({
        workspaceId: "workspace-1",
        provider: ConnectorProvider.META_ADS,
        accounts,
        selectedExternalAccountIds: ["missing"],
        encryptedCredentials: {
          ciphertext: "ciphertext",
          iv: "iv",
          authTag: "tag",
          keyVersion: "v1",
        },
      }),
    ).toThrow("Selected connector account was not found");
  });
});
