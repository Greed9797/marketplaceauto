-- Armazenamento global da plataforma: singleton conectado por um W3_ADMIN.
-- Todos os uploads do sistema passam a usar este Drive.

CREATE TABLE "PlatformStorage" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "provider" "ConnectorProvider" NOT NULL DEFAULT 'GOOGLE_DRIVE',
    "accountLabel" TEXT NOT NULL DEFAULT 'Google Drive da plataforma',
    "credentialSecretId" TEXT NOT NULL,
    "refreshCredentialSecretId" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "connectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformStorage_pkey" PRIMARY KEY ("id")
);
