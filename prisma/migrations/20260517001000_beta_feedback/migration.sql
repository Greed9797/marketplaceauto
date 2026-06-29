CREATE TYPE "BetaFeedbackType" AS ENUM ('BUG', 'SUGGESTION', 'QUESTION');

CREATE TYPE "BetaFeedbackStatus" AS ENUM ('OPEN', 'REVIEWED', 'CLOSED');

CREATE TABLE "BetaFeedback" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "userId" TEXT,
  "type" "BetaFeedbackType" NOT NULL DEFAULT 'SUGGESTION',
  "message" TEXT NOT NULL,
  "pagePath" TEXT,
  "status" "BetaFeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetaFeedback_workspaceId_createdAt_idx" ON "BetaFeedback"("workspaceId", "createdAt");
CREATE INDEX "BetaFeedback_userId_createdAt_idx" ON "BetaFeedback"("userId", "createdAt");
CREATE INDEX "BetaFeedback_status_createdAt_idx" ON "BetaFeedback"("status", "createdAt");

ALTER TABLE "BetaFeedback"
  ADD CONSTRAINT "BetaFeedback_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BetaFeedback"
  ADD CONSTRAINT "BetaFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BetaFeedback" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "beta_feedback_admin_read" ON "BetaFeedback"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY "beta_feedback_member_insert" ON "BetaFeedback"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
    )
  );

CREATE POLICY "beta_feedback_admin_update" ON "BetaFeedback"
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" IN ('OWNER', 'ADMIN')
    )
  );
