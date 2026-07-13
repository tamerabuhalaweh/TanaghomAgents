\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.organizations
    WHERE id = '10000000-0000-4000-8000-000000000001' AND is_active
  ) THEN RAISE EXCEPTION 'default organization missing'; END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.integration_connections', 'SELECT') THEN
    RAISE EXCEPTION 'n8n worker can read encrypted credentials';
  END IF;
  IF has_table_privilege('tanaghom_readonly', 'tanaghom.integration_connections', 'SELECT') THEN
    RAISE EXCEPTION 'readonly role can read encrypted credentials';
  END IF;
  IF NOT has_table_privilege('tanaghom_api', 'tanaghom.integration_connections', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'API credential management privileges missing';
  END IF;
  IF NOT has_table_privilege('tanaghom_readonly', 'tanaghom.integration_connection_status', 'SELECT') THEN
    RAISE EXCEPTION 'safe integration status view is unavailable';
  END IF;
END;
$$;

INSERT INTO tanaghom.integration_connections (
  organization_id, provider, status, base_url, credential_kind,
  configuration, configured_by, disconnected_at
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'postiz', 'disconnected',
  'https://api.postiz.com/public/v1', 'api_key', '{}'::jsonb,
  '00000000-0000-4000-8000-000000000001', statement_timestamp()
);

SET ROLE tanaghom_readonly;
SELECT provider, status FROM tanaghom.integration_connection_status;
RESET ROLE;

SELECT 'PASS: customer integration credential boundary enforced.' AS result;
