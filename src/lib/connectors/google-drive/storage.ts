import { ConnectorProvider, ConnectorStatus, type ConnectorAccount } from "@prisma/client";

import {
  connectorAccessTokenFromAccount,
  connectorRefreshTokenFromAccount,
  vaultCredentialFields,
} from "@/lib/connectors/credentials";
import {
  ensureDriveFolder,
  uploadDriveImage,
  type DriveUploadResult,
} from "@/lib/connectors/google-drive/client";
import {
  getGoogleDriveConfigForRequest,
  refreshGoogleDriveAccessToken,
} from "@/lib/connectors/google-drive/oauth";
import { prisma } from "@/lib/db/prisma";

const DRIVE_ROOT_FOLDER_NAME = "W3 Marketplace";

/** Uma conexão de Drive por workspace (externalAccountId fixo). */
export const GOOGLE_DRIVE_EXTERNAL_ACCOUNT_ID = "workspace-drive";

export async function getActiveDriveAccount(
  workspaceId: string,
): Promise<ConnectorAccount | null> {
  return prisma.connectorAccount.findFirst({
    where: {
      workspaceId,
      provider: ConnectorProvider.GOOGLE_DRIVE,
      externalAccountId: GOOGLE_DRIVE_EXTERNAL_ACCOUNT_ID,
      status: ConnectorStatus.ACTIVE,
    },
  });
}

async function freshAccessToken(account: ConnectorAccount): Promise<string> {
  const accessToken = await connectorAccessTokenFromAccount(account);
  const expiresAt = account.tokenExpiresAt?.getTime() ?? null;

  // Ainda válido com margem de 60s — usa direto.
  if (expiresAt === null || expiresAt - Date.now() > 60_000) {
    return accessToken;
  }

  const refreshToken = await connectorRefreshTokenFromAccount(account);
  const config = await getGoogleDriveConfigForRequest();
  if (!refreshToken || !config) return accessToken;

  const refreshed = await refreshGoogleDriveAccessToken({
    config,
    refreshToken,
  });

  const credentialFields = await vaultCredentialFields({
    workspaceId: account.workspaceId,
    provider: account.provider,
    externalAccountId: account.externalAccountId,
    credentials: { accessToken: refreshed.accessToken },
    refreshToken,
    tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
  });

  await prisma.connectorAccount.update({
    where: { id: account.id },
    data: credentialFields,
  });

  return refreshed.accessToken;
}

function slugifySegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}

/**
 * Fluxo de workflow de pastas no Drive do usuário:
 *   W3 Marketplace/{cliente|geral}/
 * A pasta raiz fica persistida em ConnectorAccount.metadata; subpastas por
 * cliente mantêm o Drive organizado quando o workspace gerencia várias marcas.
 */
export async function uploadImageToWorkspaceDrive(input: {
  workspaceId: string;
  clienteName?: string | null;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<DriveUploadResult & { url: string }> {
  const account = await getActiveDriveAccount(input.workspaceId);
  if (!account) throw new Error("google_drive_not_connected");

  const accessToken = await freshAccessToken(account);

  const metadata = (account.metadata ?? {}) as {
    driveRootFolderId?: string;
  };

  const rootFolderId =
    metadata.driveRootFolderId ??
    (
      await ensureDriveFolder({
        accessToken,
        name: DRIVE_ROOT_FOLDER_NAME,
      })
    ).id;

  const segment = input.clienteName
    ? slugifySegment(input.clienteName)
    : "geral";
  const targetFolder = await ensureDriveFolder({
    accessToken,
    name: segment,
    parentId: rootFolderId,
  });

  const safeName = slugifySegment(input.fileName) || "imagem";
  const driveName = `${Date.now()}-${safeName}`;

  const uploaded = await uploadDriveImage({
    accessToken,
    name: driveName,
    folderId: targetFolder.id,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  // Atualiza o ponteiro da raiz se ele não existia ainda.
  if (!metadata.driveRootFolderId) {
    await prisma.connectorAccount.update({
      where: { id: account.id },
      data: {
        metadata: {
          ...metadata,
          driveRootFolderId: rootFolderId,
          driveRootFolderName: DRIVE_ROOT_FOLDER_NAME,
        },
      },
    });
  }

  return {
    ...uploaded,
    url: `/api/files/${input.workspaceId}/${uploaded.fileId}`,
  };
}
