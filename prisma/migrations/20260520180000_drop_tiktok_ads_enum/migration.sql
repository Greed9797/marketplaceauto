-- Drop TIKTOK_ADS from ConnectorProvider enum (not on roadmap).
-- Idempotent: rebuild enum without TIKTOK_ADS only if it still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ConnectorProvider' AND e.enumlabel = 'TIKTOK_ADS'
  ) THEN
    -- Safety: refuse if any row still uses TIKTOK_ADS in any referencing column.
    IF EXISTS (SELECT 1 FROM "ConnectorAccount" WHERE provider::text = 'TIKTOK_ADS')
       OR EXISTS (SELECT 1 FROM "ConnectorProviderConfig" WHERE provider::text = 'TIKTOK_ADS')
       OR EXISTS (SELECT 1 FROM "ConnectorSelectionSession" WHERE provider::text = 'TIKTOK_ADS')
       OR EXISTS (SELECT 1 FROM "DailyMetric" WHERE source::text = 'TIKTOK_ADS')
       OR EXISTS (SELECT 1 FROM "EcommerceOrder" WHERE platform::text = 'TIKTOK_ADS')
       OR EXISTS (SELECT 1 FROM "SyncJob" WHERE provider::text = 'TIKTOK_ADS')
    THEN
      RAISE EXCEPTION 'Cannot drop TIKTOK_ADS: rows still reference it';
    END IF;

    ALTER TYPE "ConnectorProvider" RENAME TO "ConnectorProvider_old";

    CREATE TYPE "ConnectorProvider" AS ENUM (
      'META_ADS',
      'GOOGLE_ADS',
      'SHOPIFY',
      'NUVEMSHOP',
      'ISET',
      'TRAY',
      'WBUY',
      'MAGAZORD',
      'GOOGLE_SHEETS',
      'GA4',
      'SEARCH_CONSOLE'
    );

    ALTER TABLE "ConnectorAccount"
      ALTER COLUMN provider TYPE "ConnectorProvider"
      USING provider::text::"ConnectorProvider";
    ALTER TABLE "ConnectorProviderConfig"
      ALTER COLUMN provider TYPE "ConnectorProvider"
      USING provider::text::"ConnectorProvider";
    ALTER TABLE "ConnectorSelectionSession"
      ALTER COLUMN provider TYPE "ConnectorProvider"
      USING provider::text::"ConnectorProvider";
    ALTER TABLE "DailyMetric"
      ALTER COLUMN source TYPE "ConnectorProvider"
      USING source::text::"ConnectorProvider";
    ALTER TABLE "EcommerceOrder"
      ALTER COLUMN platform TYPE "ConnectorProvider"
      USING platform::text::"ConnectorProvider";
    ALTER TABLE "SyncJob"
      ALTER COLUMN provider TYPE "ConnectorProvider"
      USING provider::text::"ConnectorProvider";

    DROP TYPE "ConnectorProvider_old";
  END IF;
END$$;
