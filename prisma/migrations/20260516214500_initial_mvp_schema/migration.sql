-- CreateEnum
CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ConnectorProvider" AS ENUM ('META_ADS', 'GOOGLE_ADS', 'SHOPIFY', 'GA4', 'SEARCH_CONSOLE', 'TIKTOK_ADS');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'ACTIVE',
    "accessTokenCiphertext" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT,
    "tokenIv" TEXT NOT NULL,
    "tokenAuthTag" TEXT NOT NULL,
    "tokenKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    "tokenExpiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetric" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectorAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" "ConnectorProvider" NOT NULL,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT,
    "spend" DECIMAL(14,2),
    "impressions" BIGINT,
    "clicks" BIGINT,
    "conversions" DECIMAL(14,2),
    "conversionsValue" DECIMAL(14,2),
    "sessions" BIGINT,
    "orders" BIGINT,
    "revenue" DECIMAL(14,2),
    "dedupeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcommerceOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectorAccountId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "platform" "ConnectorProvider" NOT NULL,
    "orderNumber" TEXT,
    "customerEmail" TEXT,
    "orderTotal" DECIMAL(14,2) NOT NULL,
    "orderCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "itemsCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcommerceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "widgets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "connectorAccountId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "ConnectorAccount_workspaceId_provider_idx" ON "ConnectorAccount"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorAccount_workspaceId_provider_externalAccountId_key" ON "ConnectorAccount"("workspaceId", "provider", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_dedupeHash_key" ON "DailyMetric"("dedupeHash");

-- CreateIndex
CREATE INDEX "DailyMetric_workspaceId_date_idx" ON "DailyMetric"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "DailyMetric_workspaceId_source_date_idx" ON "DailyMetric"("workspaceId", "source", "date");

-- CreateIndex
CREATE INDEX "DailyMetric_workspaceId_campaignId_date_idx" ON "DailyMetric"("workspaceId", "campaignId", "date");

-- CreateIndex
CREATE INDEX "EcommerceOrder_workspaceId_placedAt_idx" ON "EcommerceOrder"("workspaceId", "placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EcommerceOrder_connectorAccountId_externalOrderId_key" ON "EcommerceOrder"("connectorAccountId", "externalOrderId");

-- CreateIndex
CREATE INDEX "Dashboard_workspaceId_idx" ON "Dashboard"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncJob_connectorAccountId_startedAt_idx" ON "SyncJob"("connectorAccountId", "startedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorAccount" ADD CONSTRAINT "ConnectorAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMetric" ADD CONSTRAINT "DailyMetric_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
