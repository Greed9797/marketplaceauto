ALTER TABLE "DailyMetric"
  ADD COLUMN IF NOT EXISTS "campaignStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignObjective" TEXT;
