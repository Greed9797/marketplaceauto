SET search_path = w3ads, public, extensions;

ALTER TABLE "DailyMetric"
  ADD COLUMN IF NOT EXISTS "campaignStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignObjective" TEXT,
  ADD COLUMN IF NOT EXISTS "addToCart" BIGINT;

NOTIFY pgrst, 'reload schema';
