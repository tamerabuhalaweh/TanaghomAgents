BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE provider_dispatch_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_runtime_certifications
     WHERE evidence->>'contract_version'='phase7.agent-runtime-certification.v1'
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_executor_adapter_events
     WHERE operator_ref<>'migration_0031'
  ) THEN
    RAISE EXCEPTION '0031 rollback refused because adapter lifecycle, provider-dispatch, or certification evidence exists';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION tanaghom.begin_agent_runtime_provider_dispatch(uuid,text,text)
  FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.settle_next_agent_runtime_run(text)
  FROM tanaghom_agent_runtime;
REVOKE EXECUTE ON FUNCTION tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)
  FROM tanaghom_agent_runtime;
REVOKE EXECUTE ON FUNCTION tanaghom.record_agent_runtime_certification_v2(uuid,uuid,uuid,text,jsonb,text)
  FROM tanaghom_agent_runtime;
GRANT EXECUTE ON FUNCTION tanaghom.record_agent_runtime_certification(uuid,uuid,uuid,text,jsonb,text)
  TO tanaghom_agent_runtime;

CREATE OR REPLACE FUNCTION tanaghom.claim_agent_read_invocation(p_worker_ref text)
RETURNS TABLE(
  invocation_id uuid,run_id uuid,job_id uuid,organization_id uuid,
  skill_version_id uuid,skill_code text,operation text,channel text,
  parameters jsonb,parameter_hash text,idempotency_key text,
  executor_type text,executor_ref text,executor_version text,
  integration_requirement text,instructions text,input_schema_ref text,
  output_schema_ref text,reference_manifest jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT * FROM tanaghom.claim_agent_skill_invocation_internal('read',p_worker_ref);
$$;

CREATE OR REPLACE FUNCTION tanaghom.claim_agent_proposal_invocation(p_worker_ref text)
RETURNS TABLE(
  invocation_id uuid,run_id uuid,job_id uuid,organization_id uuid,
  skill_version_id uuid,skill_code text,operation text,channel text,
  parameters jsonb,parameter_hash text,idempotency_key text,
  executor_type text,executor_ref text,executor_version text,
  integration_requirement text,instructions text,input_schema_ref text,
  output_schema_ref text,reference_manifest jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT * FROM tanaghom.claim_agent_skill_invocation_internal('proposal',p_worker_ref);
$$;

CREATE OR REPLACE FUNCTION tanaghom.claim_agent_action_invocation(p_worker_ref text)
RETURNS TABLE(
  invocation_id uuid,run_id uuid,job_id uuid,organization_id uuid,
  skill_version_id uuid,skill_code text,operation text,channel text,
  parameters jsonb,parameter_hash text,idempotency_key text,
  executor_type text,executor_ref text,executor_version text,
  integration_requirement text,instructions text,input_schema_ref text,
  output_schema_ref text,reference_manifest jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT * FROM tanaghom.claim_agent_skill_invocation_internal('action',p_worker_ref);
$$;

DROP FUNCTION tanaghom.record_agent_runtime_certification_v2(uuid,uuid,uuid,text,jsonb,text);
DROP FUNCTION tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid);
DROP FUNCTION tanaghom.settle_next_agent_runtime_run(text);
DROP FUNCTION tanaghom.begin_agent_runtime_provider_dispatch(uuid,text,text);
DROP FUNCTION tanaghom.claim_agent_skill_invocation_from_adapter(text,text);

DROP TRIGGER agent_runtime_provider_dispatch_integrity
  ON tanaghom.organization_agent_invocations;
DROP FUNCTION tanaghom.enforce_agent_runtime_provider_dispatch_integrity();
ALTER TABLE tanaghom.organization_agent_invocations
  DROP CONSTRAINT organization_agent_invocation_provider_dispatch_shape,
  DROP COLUMN provider_dispatch_started_at,
  DROP COLUMN provider_dispatch_id;

DROP TRIGGER agent_runtime_executor_adapter_integrity
  ON tanaghom.agent_runtime_executor_adapters;
DROP FUNCTION tanaghom.set_agent_runtime_executor_adapter(text,boolean,text,text);
DROP FUNCTION tanaghom.enforce_agent_runtime_executor_adapter_integrity();
DROP TRIGGER agent_runtime_executor_adapter_events_immutable
  ON tanaghom.agent_runtime_executor_adapter_events;
DROP TABLE tanaghom.agent_runtime_executor_adapter_events;
DROP TABLE tanaghom.agent_runtime_executor_adapters;

ALTER TABLE tanaghom.organization_agent_runtime_events
  DROP CONSTRAINT organization_agent_runtime_events_event_type_check;
ALTER TABLE tanaghom.organization_agent_runtime_events
  ADD CONSTRAINT organization_agent_runtime_events_event_type_check CHECK (
    event_type IN (
      'job_queued','job_claimed','plan_recorded','invocation_proposed',
      'invocation_denied','approval_recorded','invocation_claimed',
      'invocation_completed','run_completed','run_failed',
      'dependency_blocked','dependency_reconciled','agent_promoted'
    )
  );

DELETE FROM public.schema_migrations
WHERE version='0031_policy_runtime_executors_certification';

COMMIT;
