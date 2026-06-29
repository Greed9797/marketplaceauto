-- Sliding-window activity marker for session idle invalidation. Backfilled
-- as NULL so existing sessions stay valid until their next request, which
-- writes the first `lastSeenAt`. After that, sessions idle > N days are
-- rejected even when `expires` is still in the future.
ALTER TABLE "w3ads"."Session"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Session_lastSeenAt_idx"
  ON "w3ads"."Session" ("lastSeenAt");
