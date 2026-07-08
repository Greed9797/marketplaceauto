-- AlterEnum
-- Adds the Levane connector provider. Levane runs its storefront on Supabase
-- and exposes orders straight off PostgREST; it is consumed as a manual-commerce
-- provider (login exchanged for a Supabase access token at sync time).
-- Append-only — enum value order is positional in PostgreSQL, so existing values
-- must never be reordered or removed.
-- IF NOT EXISTS: value was applied out-of-band to prod ahead of deploy, so the
-- managed migrate run must be a safe no-op instead of erroring on a dup label.
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'LEVANE';
