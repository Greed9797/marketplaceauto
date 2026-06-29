CREATE TABLE IF NOT EXISTS w3ads._prisma_migrations (
  id varchar(36) PRIMARY KEY,
  checksum varchar(64) NOT NULL,
  finished_at timestamptz,
  migration_name varchar(255) NOT NULL,
  logs text,
  rolled_back_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  applied_steps_count integer NOT NULL DEFAULT 0
);

INSERT INTO w3ads._prisma_migrations (
  id,
  checksum,
  finished_at,
  migration_name,
  logs,
  rolled_back_at,
  started_at,
  applied_steps_count
)
SELECT *
FROM (
  VALUES
    (
      'w3ads-baseline-20260516214500',
      'c2e37d0885559f33ffe3b4b7c9c268bb3e22ba7f61d378af3be8d7d3ba286cb4',
      now(),
      '20260516214500_initial_mvp_schema',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260516221000',
      '02cf405381b8c56b20ac82c530e563a39a323bcaa8166ac4a266767e6cc25cb1',
      now(),
      '20260516221000_auth_multi_tenant',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260517000000',
      '5c0dba941953ebd91d964f6bc2b824a5db535760301071dfbbb870e668656f6e',
      now(),
      '20260517000000_lgpd_soft_delete',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260517001000',
      '53e8ac55d8ed2001d1c9935d556de2c4e2b8669694d11b57be294d097b58a223',
      now(),
      '20260517001000_beta_feedback',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260518103000',
      'e23be2f55aedfc61906750bdc8e922033f28098127d4a76b3517a690a05dce22',
      now(),
      '20260518103000_expanded_connector_providers',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260518112000',
      'd1d1c487ba64933618ea80f62560f9f1f07d4ce2901f61624b12b2b03cb0e825',
      now(),
      '20260518112000_connector_provider_config_vault',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260518123000',
      '9ac304a6afd2eca4ed56293621fef0cea6718718fba5b28963065840b738fb0a',
      now(),
      '20260518123000_adstart_workspace_role_flow',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    ),
    (
      'w3ads-baseline-20260518160000',
      '6a4437c4e24cb5994db4f322aca433f011b73f7e0aff9c6ae584ed05a09fa36a',
      now(),
      '20260518160000_syncjob_operational_tracking',
      NULL::text,
      NULL::timestamptz,
      now(),
      1
    )
) AS source(
  id,
  checksum,
  finished_at,
  migration_name,
  logs,
  rolled_back_at,
  started_at,
  applied_steps_count
)
WHERE NOT EXISTS (
  SELECT 1
  FROM w3ads._prisma_migrations existing
  WHERE existing.migration_name = source.migration_name
);

NOTIFY pgrst, 'reload schema';
