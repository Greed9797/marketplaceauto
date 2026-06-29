-- Account-handover review timer ("passagem de conta"). Internal W3 managers
-- start/stop a timer per brand; each session is one log row. startedAt is the
-- server source of truth, so closing the site does not stop the count.

-- CreateTable
CREATE TABLE "AccountReviewSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountReviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountReviewSession_workspaceId_startedAt_idx" ON "AccountReviewSession"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "AccountReviewSession_userId_startedAt_idx" ON "AccountReviewSession"("userId", "startedAt");

-- At most ONE running session (endedAt IS NULL) per user at a time. Starting a
-- timer for another brand while one is running violates this and is rejected.
CREATE UNIQUE INDEX "AccountReviewSession_one_active_per_user"
    ON "AccountReviewSession" ("userId") WHERE "endedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "AccountReviewSession" ADD CONSTRAINT "AccountReviewSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountReviewSession" ADD CONSTRAINT "AccountReviewSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (defense-in-depth — server-side Prisma still enforces the
-- real authorization in the timer server actions). Policies are scoped to MATCH
-- the business rule, not exceed it:
--   * Read: only the workspace OWNER (Admin Master is a platform role, not
--     expressible via Membership, so it stays an app-layer concern). VIEWER /
--     ADMIN / CLIENT must NOT see another manager's timing logs.
--   * Write: the running manager may INSERT their own session and UPDATE it only
--     while it is still open (stop-once). No self-DELETE and no rewriting of a
--     closed row — log integrity. Admin/OWNER deletions go through the
--     privileged Prisma connection in deleteSessionAction.
ALTER TABLE "AccountReviewSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_review_session_owner_read" ON "AccountReviewSession"
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND "workspaceId" IN (
      SELECT "workspaceId" FROM "Membership"
      WHERE "userId" = auth.uid()::text
        AND "role" = 'OWNER'
    )
  );

CREATE POLICY "account_review_session_self_insert" ON "AccountReviewSession"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
  );

-- Only an OPEN session (endedAt IS NULL) owned by the actor can be updated —
-- this is the "stop" write. Once endedAt is set the row is immutable to the
-- manager, so a slow passagem cannot be quietly rewritten at the DB layer.
CREATE POLICY "account_review_session_self_stop" ON "AccountReviewSession"
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
    AND "endedAt" IS NULL
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "userId" = auth.uid()::text
  );
