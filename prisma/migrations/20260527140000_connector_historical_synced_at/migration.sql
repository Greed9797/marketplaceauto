-- Marks when the first deep historical backfill completed for the account.
-- NULL on existing rows so the next sync auto-runs a one-time catch-up.
ALTER TABLE "ConnectorAccount"
  ADD COLUMN IF NOT EXISTS "historicalSyncedAt" TIMESTAMP(3);
