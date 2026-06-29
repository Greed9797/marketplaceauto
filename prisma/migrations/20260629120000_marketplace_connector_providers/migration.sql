-- AlterEnum
-- Adds the marketplace connector providers: orders (Mercado Livre, Shopee) and
-- the native marketplace ad sources (Shopee Ads, Mercado Livre Ads, written to
-- DailyMetric.source). Append-only — enum value order is positional in
-- PostgreSQL, so existing values must never be reordered or removed.
-- PostgreSQL 12+ (Supabase) applies all four additions in a single migration.
ALTER TYPE "ConnectorProvider" ADD VALUE 'MERCADO_LIVRE';
ALTER TYPE "ConnectorProvider" ADD VALUE 'SHOPEE';
ALTER TYPE "ConnectorProvider" ADD VALUE 'SHOPEE_ADS';
ALTER TYPE "ConnectorProvider" ADD VALUE 'MERCADO_LIVRE_ADS';
