-- Add Meta pixel event aggregates to DailyMetric.
-- Idempotent for safe re-run.
ALTER TABLE "DailyMetric" ADD COLUMN IF NOT EXISTS "leads" BIGINT;
ALTER TABLE "DailyMetric" ADD COLUMN IF NOT EXISTS "scheduledEvents" BIGINT;
