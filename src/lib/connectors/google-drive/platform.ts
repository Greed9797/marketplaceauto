import { ConnectorProvider } from "@prisma/client";

import {
  connectorCredentialsFromAccountVaultAware,
  connectorRefreshTokenFromAccount,
  vaultCredentialFields,
} from "@/lib/connectors/credentials";
import { ensureDriveFolder, uploadDriveImage } from "@/lib/connectors/google-drive/client";
import {
  getGoogleDriveConfigForRequest,
  refreshGoogleDriveAccessToken,
} from "@/lib/connectors/google-drive/oauth";
import { prisma } from "@/lib/db/prisma";

const PLATFORM_STORAGE_ID = "platform";
const PLATFORM_ROOT_FOLDER_NAME = "W3 Marketplace";

export type PlatformStorageRow = {
  id: string;
  provider: ConnectorProvider;
  accountLabel: string;
  credentialSecretId: string;
  refreshCredentialSecretId: string | null;
  tokenExpiresAt: Date | null;
  metadata: unknown;
  connectedByUserId: string | null;
};

export async function getPlatformStorage(): Promise<PlatformStorageRow | null> {
  return prisma.platformStorage.findUnique({ where: { id: PLATFORM_STORAGE_ID } });
}

/**
 * Conecta (ou reconecta) o Drive global da plataforma. Chamado pelo callback
 * OAuth quando o escopo "platform" está ativo — restrito a W3_ADMIN.
 */
export async function connectPlatformStorage(input: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
}): Promise<{ rootFolderId: string }> {
  const rootFolder = await ensureDriveFolder({
    accessToken: input.accessToken,
    name: PLATFORM_ROOT_FOLDER_NAME,
  });

  const credentialFields = await vaultCredentialFields({
    // Namespace próprio no Vault — não pertence a nenhum workspace.
    workspaceId: "PLATFORM",
    provider: ConnectorProvider.GOOGLE_DRIVE,
    externalAccountId: "platform-storage",
    credentials: { accessToken: input.accessToken },
    refreshToken: input.refreshToken,
    tokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
  });

  await prisma.platformStorage.upsert({
    where: { id: PLATFORM_STORAGE_ID },
    update: {
      credentialSecretId: credentialFields.credentialSecretId!,
      refreshCredentialSecretId: credentialFields.refreshCredentialSecretId,
      tokenExpiresAt: credentialFields.tokenExpiresAt,
      metadata: {
        scope: input.scope,
        driveRootFolderId: rootFolder.id,
        driveRootFolderName: rootFolder.name,
      },
      connectedByUserId: input.userId,
    },
    create: {
      id: PLATFORM_STORAGE_ID,
      credentialSecretId: credentialFields.credentialSecretId!,
      refreshCredentialSecretId: credentialFields.refreshCredentialSecretId,
      tokenExpiresAt: credentialFields.tokenExpiresAt,
      metadata: {
        scope: input.scope,
        driveRootFolderId: rootFolder.id,
        driveRootFolderName: rootFolder.name,
      },
      connectedByUserId: input.userId,
    },
  });

  return { rootFolderId: rootFolder.id };
}

async function freshAccessToken(row: PlatformStorageRow): Promise<string> {
  const credentials = await connectorCredentialsFromAccountVaultAware({
    credentialSecretId: row.credentialSecretId,
    accessTokenCiphertext: "vault",
    tokenIv: "vault",
    tokenAuthTag: "vault",
    tokenKeyVersion: "vault",
  });
  let accessToken = credentials.accessToken as string;

  const expiresAt = row.tokenExpiresAt?.getTime() ?? null;
  if (expiresAt === null || expiresAt - Date.now() > 60_000) {
    return accessToken;
  }

  const refreshToken = await connectorRefreshTokenFromAccount({
    refreshCredentialSecretId: row.refreshCredentialSecretId,
    refreshTokenCiphertext: null,
  });
  const config = await getGoogleDriveConfigForRequest();
  if (!refreshToken || !config) return accessToken;

  const refreshed = await refreshGoogleDriveAccessToken({ config, refreshToken });
  const credentialFields = await vaultCredentialFields({
    workspaceId: "PLATFORM",
    provider: ConnectorProvider.GOOGLE_DRIVE,
    externalAccountId: "platform-storage",
    credentials: { accessToken: refreshed.accessToken },
    refreshToken,
    tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
  });

  await prisma.platformStorage.update({
    where: { id: PLATFORM_STORAGE_ID },
    data: {
      credentialSecretId: credentialFields.credentialSecretId!,
      refreshCredentialSecretId: credentialFields.refreshCredentialSecretId,
      tokenExpiresAt: credentialFields.tokenExpiresAt,
    },
  });

  accessToken = refreshed.accessToken;
  return accessToken;
}

/**
 * Access token do Drive global com renovação — MESMA função usada no upload.
 * O proxy /api/platform-files/[fileId] consome isto para que download nunca
 * sirva com um token expirado. Retorna null quando o Drive global não está
 * conectado.
 */
export async function getPlatformDriveAccessToken(): Promise<string | null> {
  const row = await getPlatformStorage();
  if (!row) return null;
  return freshAccessToken(row);
}

function slugifySegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}

/**
 * Upload no Drive global. Estrutura:
 *   W3 Marketplace/{workspaceSlug|geral}/{cliente|geral}/arquivo
 * Disponível para todos os workspaces — é o backup/armazenamento do sistema.
 */
export async function uploadImageToPlatformDrive(input: {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  segments?: Array<string | null | undefined>;
}): Promise<{ fileId: string; name: string; mimeType: string; url: string }> {
  const row = await getPlatformStorage();
  if (!row) throw new Error("platform_drive_not_connected");

  const accessToken = await freshAccessToken(row);
  const metadata = (row.metadata ?? {}) as { driveRootFolderId?: string };

  const rootFolderId =
    metadata.driveRootFolderId ??
    (
      await ensureDriveFolder({
        accessToken,
        name: PLATFORM_ROOT_FOLDER_NAME,
      })
    ).id;

  let parentId = rootFolderId;
  for (const raw of input.segments ?? []) {
    const segment = raw ? slugifySegment(raw) : "";
    if (!segment) continue;
    const folder = await ensureDriveFolder({
      accessToken,
      name: segment,
      parentId,
    });
    parentId = folder.id;
  }

  const safeName = slugifySegment(input.fileName) || "imagem";
  const uploaded = await uploadDriveImage({
    accessToken,
    name: `${Date.now()}-${safeName}`,
    folderId: parentId,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  if (!metadata.driveRootFolderId) {
    await prisma.platformStorage.update({
      where: { id: PLATFORM_STORAGE_ID },
      data: {
        metadata: {
          ...(metadata as object),
          driveRootFolderId: rootFolderId,
          driveRootFolderName: PLATFORM_ROOT_FOLDER_NAME,
        },
      },
    });
  }

  return { ...uploaded, url: `/api/platform-files/${uploaded.fileId}` };
}
