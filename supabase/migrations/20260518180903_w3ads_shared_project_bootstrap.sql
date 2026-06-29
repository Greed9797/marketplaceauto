-- W3ADS bootstrap for the shared Supabase project tuzoczzohirqddrcpbtc.
-- Run this BEFORE `npx prisma migrate deploy`.
--
-- This file is intentionally schema-only. Prisma migrations create the app tables
-- in `w3ads` when DATABASE_URL and DIRECT_URL include `?schema=w3ads`.

BEGIN;

CREATE SCHEMA IF NOT EXISTS w3ads;

GRANT USAGE ON SCHEMA w3ads TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA w3ads
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA w3ads
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA w3ads
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Keep the existing app schemas first and append W3ADS before public. This keeps
-- existing Pulmao/SaaS behavior intact while allowing app-specific PostgREST calls.
ALTER ROLE authenticator SET search_path = pulmao, saas, w3ads, hub, public, extensions;
ALTER ROLE anon SET search_path = pulmao, saas, w3ads, hub, public;
ALTER ROLE authenticated SET search_path = pulmao, saas, w3ads, hub, public;
ALTER ROLE service_role SET search_path = pulmao, saas, w3ads, hub, public;

-- Grants for objects created by Prisma migrations after this bootstrap.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA w3ads TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA w3ads TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA w3ads TO anon, authenticated, service_role;

-- Supabase Vault is required for connector secrets. The extension may already
-- exist on the shared project; IF NOT EXISTS keeps this safe.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

NOTIFY pgrst, 'reload schema';

COMMIT;
