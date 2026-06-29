-- Earliest month-start (UTC) already covered by the incremental backfill.
-- NULL means no past month has been backfilled yet; once it reaches
-- monthStart(now - 1095 days) the orchestrator stamps historicalSyncedAt
-- and stops the loop.
ALTER TABLE "ConnectorAccount"
  ADD COLUMN IF NOT EXISTS "historicalBackfillUntil" TIMESTAMP(3);
