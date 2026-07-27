\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters)<>3
    OR (SELECT count(*) FROM tanaghom.agent_runtime_executor_adapter_events
         WHERE operator_ref='migration_0031' AND enabled=false)<>3
    OR EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_executor_adapters WHERE enabled
    )
    OR NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_executor_adapters
       WHERE code='phase7d_read_executor_v1'
         AND credential_scope=ARRAY[
           'agent_runtime_database','gemma_private_api','integration_gateway'
         ]::text[]
    )
    OR NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_executor_adapters
       WHERE code='phase7d_proposal_executor_v1'
         AND credential_scope=ARRAY[
           'agent_runtime_database','gemma_private_api'
         ]::text[]
    )
    OR NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_executor_adapters
       WHERE code='phase7d_action_executor_v1'
         AND credential_scope=ARRAY[
           'agent_runtime_database','integration_gateway'
         ]::text[]
    )
  THEN
    RAISE EXCEPTION 'fixed executor adapter registry is incomplete or not fail-closed';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege(
      'tanaghom_api','tanaghom.agent_runtime_executor_adapters','SELECT'
    )
    OR has_table_privilege(
      'tanaghom_agent_runtime','tanaghom.agent_runtime_executor_adapters','SELECT'
    )
    OR has_function_privilege(
      'tanaghom_agent_runtime',
      'tanaghom.set_agent_runtime_executor_adapter(text,boolean,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'tanaghom_skill_read_executor',
      'tanaghom.set_agent_runtime_executor_adapter(text,boolean,text,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_api',
      'tanaghom.begin_agent_runtime_provider_dispatch(uuid,text,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_agent_runtime',
      'tanaghom.settle_next_agent_runtime_run(text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_agent_runtime',
      'tanaghom.record_agent_runtime_certification_v2(uuid,uuid,uuid,text,jsonb,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'tanaghom_agent_runtime',
      'tanaghom.record_agent_runtime_certification(uuid,uuid,uuid,text,jsonb,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_skill_read_executor',
      'tanaghom.claim_agent_read_invocation(text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'tanaghom_skill_read_executor',
      'tanaghom.claim_agent_action_invocation(text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'executor, gateway, or certification privileges are not least privileged';
  END IF;
END;
$$;

SET ROLE tanaghom_skill_read_executor;
DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.claim_agent_read_invocation(
    'phase7d_read_executor_v1'
  ))<>0 THEN
    RAISE EXCEPTION 'disabled read adapter unexpectedly claimed work';
  END IF;
  IF (SELECT count(*) FROM tanaghom.claim_agent_read_invocation(
    'unreviewed_read_executor'
  ))<>0 THEN
    RAISE EXCEPTION 'unreviewed read executor unexpectedly claimed work';
  END IF;
END;
$$;
RESET ROLE;

SELECT tanaghom.set_agent_runtime_executor_adapter(
  'phase7d_proposal_executor_v1',
  true,
  'Disposable exact adapter enablement contract test only.',
  'phase7d_test_operator'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_executor_adapters
     WHERE code='phase7d_proposal_executor_v1' AND enabled
       AND state_reason='Disposable exact adapter enablement contract test only.'
  ) THEN
    RAISE EXCEPTION 'reviewed adapter state transition did not persist evidence';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_executor_adapter_events
     WHERE adapter_code='phase7d_proposal_executor_v1'
       AND enabled
       AND reason='Disposable exact adapter enablement contract test only.'
       AND operator_ref='phase7d_test_operator'
  ) THEN
    RAISE EXCEPTION 'adapter state audit event was not recorded';
  END IF;
  BEGIN
    UPDATE tanaghom.agent_runtime_executor_adapters
       SET supported_executor_refs=ARRAY['unreviewed_executor']
     WHERE code='phase7d_proposal_executor_v1';
    RAISE EXCEPTION 'immutable adapter authority unexpectedly changed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='immutable adapter authority unexpectedly changed' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;

SELECT 'PASS: executor adapters default disabled, remain immutable, and expose only least-privilege runtime functions.' AS result;
