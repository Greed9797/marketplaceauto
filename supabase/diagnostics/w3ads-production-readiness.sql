-- Read-only production readiness scan for the shared Supabase project.
-- Run after bootstrap + migrations, before opening public traffic.
-- Expected project/schema: tuzoczzohirqddrcpbtc / w3ads.

SET search_path = w3ads, public, extensions;

WITH expected_tables(table_name) AS (
  VALUES
    ('User'),
    ('Account'),
    ('Session'),
    ('Workspace'),
    ('Membership'),
    ('WorkspaceInvite'),
    ('ConnectorAccount'),
    ('ConnectorProviderConfig'),
    ('ConnectorSelectionSession'),
    ('DailyMetric'),
    ('EcommerceOrder'),
    ('EcommerceOrderItem'),
    ('Dashboard'),
    ('AuditLog'),
    ('SyncJob'),
    ('BetaFeedback'),
    ('PasswordResetToken')
),
expected_daily_metric_columns(column_name) AS (
  VALUES
    ('campaignStatus'),
    ('campaignObjective'),
    ('addToCart')
),
expected_providers(provider) AS (
  VALUES
    ('META_ADS'),
    ('GOOGLE_ADS'),
    ('SHOPIFY'),
    ('NUVEMSHOP'),
    ('ISET'),
    ('TRAY'),
    ('WBUY'),
    ('MAGAZORD'),
    ('GOOGLE_SHEETS'),
    ('GA4')
),
table_state AS (
  SELECT
    t.table_name,
    c.oid IS NOT NULL AS exists,
    COALESCE(c.relrowsecurity, false) AS rls_enabled
  FROM expected_tables t
  LEFT JOIN pg_class c
    ON c.relname = t.table_name
  LEFT JOIN pg_namespace n
    ON n.oid = c.relnamespace
   AND n.nspname = 'w3ads'
),
checks AS (
  SELECT
    'schema' AS category,
    'w3ads schema exists' AS check_name,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'w3ads') AS ok,
    NULL::text AS detail
  UNION ALL
  SELECT
    'vault',
    'Supabase Vault installed',
    to_regclass('vault.secrets') IS NOT NULL,
    NULL::text
  UNION ALL
  SELECT
    'table',
    table_name || ' exists',
    exists,
    CASE WHEN exists THEN NULL ELSE table_name END
  FROM table_state
  UNION ALL
  SELECT
    'rls',
    table_name || ' RLS enabled',
    rls_enabled,
    CASE WHEN rls_enabled THEN NULL ELSE table_name END
  FROM table_state
  WHERE exists
    AND table_name <> '_prisma_migrations'
  UNION ALL
  SELECT
    'column',
    'DailyMetric.' || c.column_name || ' exists',
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'w3ads'
        AND table_name = 'DailyMetric'
        AND column_name = c.column_name
    ),
    c.column_name
  FROM expected_daily_metric_columns c
  UNION ALL
  SELECT
    'enum',
    'ConnectorProvider.' || provider || ' exists',
    EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'w3ads'
        AND t.typname = 'ConnectorProvider'
        AND e.enumlabel = provider
    ),
    provider
  FROM expected_providers
  UNION ALL
  SELECT
    'policy',
    'CLIENT reads DailyMetric/EcommerceOrder/Dashboard via workspace membership',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'w3ads'
        AND tablename = 'DailyMetric'
        AND policyname = 'daily_metric_member_read'
    )
    AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'w3ads'
        AND tablename = 'EcommerceOrder'
        AND policyname = 'ecommerce_order_member_read'
    )
    AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'w3ads'
        AND tablename = 'Dashboard'
        AND policyname = 'dashboard_member_read'
    ),
    NULL::text
  UNION ALL
  SELECT
    'policy',
    'CLIENT blocked from connector/provider config reads',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'w3ads'
        AND tablename = 'ConnectorAccount'
        AND policyname = 'connector_account_member_read'
        AND cmd = 'SELECT'
        AND qual LIKE '%OWNER%'
        AND qual LIKE '%ADMIN%'
        AND qual LIKE '%VIEWER%'
        AND qual NOT LIKE '%CLIENT%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'w3ads'
        AND tablename = 'ConnectorProviderConfig'
        AND policyname = 'connector_provider_config_member_read'
        AND cmd = 'SELECT'
        AND qual NOT LIKE '%CLIENT%'
    ),
    NULL::text
  UNION ALL
  SELECT
    'function',
    'single-client-workspace trigger uses w3ads search path',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'w3ads'
        AND p.proname = 'enforce_single_client_workspace'
        AND COALESCE(array_to_string(p.proconfig, ','), '') LIKE '%search_path=w3ads, public%'
    ),
    NULL::text
)
SELECT
  category,
  check_name,
  CASE WHEN ok THEN 'ok' ELSE 'fail' END AS status,
  detail
FROM checks
ORDER BY
  CASE WHEN ok THEN 1 ELSE 0 END,
  category,
  check_name;
