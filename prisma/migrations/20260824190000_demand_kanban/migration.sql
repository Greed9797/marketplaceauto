-- Kanban de demandas com timer persistente e outbox de alertas MCRM.
-- Intencionalmente sem schema hardcoded: o alvo e definido por
-- DATABASE_URL/DIRECT_URL e deve ser exclusivamente w3marketplace.

CREATE TYPE "DemandTaskStatus" AS ENUM ('TODO', 'RUNNING', 'PAUSED', 'DONE');
CREATE TYPE "DemandAlertThreshold" AS ENUM ('OVER_BY_50', 'OVER_BY_100');
CREATE TYPE "DemandAlertRecipient" AS ENUM ('ASSIGNEE', 'LEADER', 'GROUP');
CREATE TYPE "DemandAlertStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

CREATE TABLE "DemandCategory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#D90429',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemandCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemandTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "DemandTaskStatus" NOT NULL DEFAULT 'TODO',
    "accumulatedSeconds" INTEGER NOT NULL DEFAULT 0,
    "runningSince" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemandTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemandMemberProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaderUserId" TEXT,
    "mcrmConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemandMemberProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemandNotificationConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mcrmBaseUrl" TEXT,
    "mcrmTokenSecretId" TEXT,
    "generalGroupConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemandNotificationConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemandAlert" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "threshold" "DemandAlertThreshold" NOT NULL,
    "recipient" "DemandAlertRecipient" NOT NULL,
    "status" "DemandAlertStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemandAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemandCategory_workspaceId_name_key" ON "DemandCategory"("workspaceId", "name");
CREATE INDEX "DemandCategory_workspaceId_active_position_idx" ON "DemandCategory"("workspaceId", "active", "position");
CREATE INDEX "DemandTask_workspaceId_status_position_idx" ON "DemandTask"("workspaceId", "status", "position");
CREATE INDEX "DemandTask_workspaceId_assigneeId_status_idx" ON "DemandTask"("workspaceId", "assigneeId", "status");
CREATE INDEX "DemandTask_categoryId_idx" ON "DemandTask"("categoryId");
CREATE UNIQUE INDEX "DemandTask_one_running_per_assignee_idx" ON "DemandTask"("workspaceId", "assigneeId") WHERE "status" = 'RUNNING';
CREATE UNIQUE INDEX "DemandMemberProfile_workspaceId_userId_key" ON "DemandMemberProfile"("workspaceId", "userId");
CREATE INDEX "DemandMemberProfile_workspaceId_leaderUserId_idx" ON "DemandMemberProfile"("workspaceId", "leaderUserId");
CREATE UNIQUE INDEX "DemandNotificationConfig_workspaceId_key" ON "DemandNotificationConfig"("workspaceId");
CREATE UNIQUE INDEX "DemandAlert_taskId_threshold_recipient_key" ON "DemandAlert"("taskId", "threshold", "recipient");
CREATE INDEX "DemandAlert_status_nextAttemptAt_createdAt_idx" ON "DemandAlert"("status", "nextAttemptAt", "createdAt");

ALTER TABLE "DemandCategory" ADD CONSTRAINT "DemandCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandTask" ADD CONSTRAINT "DemandTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandTask" ADD CONSTRAINT "DemandTask_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DemandCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemandTask" ADD CONSTRAINT "DemandTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandTask" ADD CONSTRAINT "DemandTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemandMemberProfile" ADD CONSTRAINT "DemandMemberProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandMemberProfile" ADD CONSTRAINT "DemandMemberProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandMemberProfile" ADD CONSTRAINT "DemandMemberProfile_leaderUserId_fkey" FOREIGN KEY ("leaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DemandNotificationConfig" ADD CONSTRAINT "DemandNotificationConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemandAlert" ADD CONSTRAINT "DemandAlert_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DemandTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DemandCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemandTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemandMemberProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemandNotificationConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemandAlert" ENABLE ROW LEVEL SECURITY;
