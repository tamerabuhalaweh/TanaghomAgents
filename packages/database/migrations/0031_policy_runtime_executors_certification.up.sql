BEGIN;

CREATE TABLE tanaghom.agent_runtime_executor_adapters (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  executor_class text NOT NULL CHECK (executor_class IN ('read','proposal','action')),
  workflow_id text NOT NULL UNIQUE CHECK (workflow_id ~ '^phase7d[A-Za-z0-9]{6,79}V[1-9][0-9]*$'),
  workflow_version text NOT NULL CHECK (workflow_version ~ '^v[1-9][0-9]*$'),
  workflow_sha256 text NOT NULL CHECK (workflow_sha256 ~ '^[a-f0-9]{64}$'),
  supported_executor_refs text[] NOT NULL CHECK (
    cardinality(supported_executor_refs) BETWEEN 1 AND 8
  ),
  supported_operations text[] NOT NULL CHECK (
    cardinality(supported_operations) BETWEEN 1 AND 20
  ),
  credential_scope text[] NOT NULL CHECK (
    cardinality(credential_scope) BETWEEN 1 AND 3
    AND credential_scope <@ ARRAY[
      'agent_runtime_database','gemma_private_api','integration_gateway'
    ]::text[]
  ),
  enabled boolean NOT NULL DEFAULT false,
  state_reason text NOT NULL CHECK (length(trim(state_reason)) BETWEEN 10 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (
    'agent_runtime_database'=ANY(credential_scope)
    AND CASE executor_class
      WHEN 'read' THEN credential_scope=ARRAY[
        'agent_runtime_database','gemma_private_api','integration_gateway'
      ]::text[]
      WHEN 'proposal' THEN credential_scope=ARRAY[
        'agent_runtime_database','gemma_private_api'
      ]::text[]
      WHEN 'action' THEN credential_scope=ARRAY[
        'agent_runtime_database','integration_gateway'
      ]::text[]
    END
  ),
  CHECK (
    array_to_string(supported_executor_refs||supported_operations,',')
      !~* '(^|[.:/_-])(all|any)([.:/_-]|$)|\*'
  )
);

INSERT INTO tanaghom.agent_runtime_executor_adapters (
  code,executor_class,workflow_id,workflow_version,workflow_sha256,
  supported_executor_refs,supported_operations,credential_scope,state_reason
) VALUES
(
  'phase7d_read_executor_v1','read','phase7dReadExecutorV1','v1',
  '524d2af3ed8be536cb9587c293c8f09db7a9e83fd895a3acf25a5e9ec886306d',
  ARRAY['postiz_performance_monitor','quality_shadow_evaluator'],
  ARRAY['postiz.performance.read','quality.reply.evaluate'],
  ARRAY['agent_runtime_database','gemma_private_api','integration_gateway'],
  'Disabled until the fixed read adapter, read-only credentials, and gateway boundary are deployed and approved.'
),
(
  'phase7d_proposal_executor_v1','proposal','phase7dProposalExecutorV1','v1',
  '628770e4d4ca4e8b09f61592f617df2539caf59defc07d12a717c5651c3a6a59',
  ARRAY['campaign_strategy_generator','campaign_content_generator','conversation_intelligence_worker'],
  ARRAY['campaign.strategy.propose','campaign.content.propose','conversation.reply.propose'],
  ARRAY['agent_runtime_database','gemma_private_api'],
  'Disabled until the fixed proposal adapter, proposal-only identity, and Gemma boundary are deployed and approved.'
),
(
  'phase7d_action_executor_v1','action','phase7dActionExecutorV1','v1',
  'f6e7c1a9ee61dc941141f1c35b8fabe8dcffe94600e268d298811bc425f456b8',
  ARRAY['postiz_draft_publisher','ghl_contact_sync','governed_ghl_actions'],
  ARRAY[
    'postiz.draft.create','ghl.contact.upsert','ghl.appointment.execute',
    'ghl.assignment.execute','ghl.message.execute','ghl.nurture.execute',
    'ghl.opportunity.execute','ghl.qualification.execute','ghl.status.execute',
    'ghl.tag.execute'
  ],
  ARRAY['agent_runtime_database','integration_gateway'],
  'Disabled until the fixed action adapter, action-only identity, provider allowlists, and human approval boundary pass UAT.'
);

CREATE TABLE tanaghom.agent_runtime_executor_adapter_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adapter_code text NOT NULL REFERENCES tanaghom.agent_runtime_executor_adapters(code),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  operator_ref text NOT NULL CHECK (operator_ref ~ '^[a-z][a-z0-9._-]{2,79}$'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TRIGGER agent_runtime_executor_adapter_events_immutable
BEFORE UPDATE OR DELETE ON tanaghom.agent_runtime_executor_adapter_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

INSERT INTO tanaghom.agent_runtime_executor_adapter_events (
  adapter_code,enabled,reason,operator_ref
)
SELECT code,enabled,state_reason,'migration_0031'
  FROM tanaghom.agent_runtime_executor_adapters
 ORDER BY code;

CREATE FUNCTION tanaghom.enforce_agent_runtime_executor_adapter_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('INSERT','DELETE')
    OR NEW.code IS DISTINCT FROM OLD.code
    OR NEW.executor_class IS DISTINCT FROM OLD.executor_class
    OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
    OR NEW.workflow_version IS DISTINCT FROM OLD.workflow_version
    OR NEW.workflow_sha256 IS DISTINCT FROM OLD.workflow_sha256
    OR NEW.supported_executor_refs IS DISTINCT FROM OLD.supported_executor_refs
    OR NEW.supported_operations IS DISTINCT FROM OLD.supported_operations
    OR NEW.credential_scope IS DISTINCT FROM OLD.credential_scope
  THEN
    RAISE EXCEPTION 'reviewed executor adapter identity and authority are immutable';
  END IF;
  IF NEW.enabled IS DISTINCT FROM OLD.enabled
    AND length(trim(coalesce(NEW.state_reason,'')))<10
  THEN
    RAISE EXCEPTION 'bounded executor adapter state evidence required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_executor_adapter_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.agent_runtime_executor_adapters
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_agent_runtime_executor_adapter_integrity();

CREATE FUNCTION tanaghom.set_agent_runtime_executor_adapter(
  p_code text,p_enabled boolean,p_reason text,p_operator_ref text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF p_code !~ '^phase7d_(read|proposal|action)_executor_v1$'
    OR p_enabled IS NULL
    OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000
    OR p_operator_ref !~ '^[a-z][a-z0-9._-]{2,79}$'
  THEN
    RAISE EXCEPTION 'exact adapter, state, reason, and operator are required';
  END IF;
  UPDATE tanaghom.agent_runtime_executor_adapters
     SET enabled=p_enabled,state_reason=trim(p_reason),updated_at=statement_timestamp()
   WHERE code=p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown reviewed executor adapter'; END IF;
  INSERT INTO tanaghom.agent_runtime_executor_adapter_events (
    adapter_code,enabled,reason,operator_ref
  ) VALUES (
    p_code,p_enabled,trim(p_reason),p_operator_ref
  );
  RETURN CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END;
END;
$$;

ALTER TABLE tanaghom.organization_agent_invocations
  ADD COLUMN provider_dispatch_id uuid,
  ADD COLUMN provider_dispatch_started_at timestamptz,
  ADD CONSTRAINT organization_agent_invocation_provider_dispatch_shape CHECK (
    (provider_dispatch_id IS NULL)=(provider_dispatch_started_at IS NULL)
  );

CREATE FUNCTION tanaghom.enforce_agent_runtime_provider_dispatch_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.provider_dispatch_id IS NOT NULL AND (
    NEW.provider_dispatch_id IS DISTINCT FROM OLD.provider_dispatch_id
    OR NEW.provider_dispatch_started_at IS DISTINCT FROM OLD.provider_dispatch_started_at
  ) THEN
    RAISE EXCEPTION 'provider dispatch identity and start evidence are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_provider_dispatch_integrity
BEFORE UPDATE ON tanaghom.organization_agent_invocations
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_agent_runtime_provider_dispatch_integrity();

ALTER TABLE tanaghom.organization_agent_runtime_events
  DROP CONSTRAINT organization_agent_runtime_events_event_type_check;
ALTER TABLE tanaghom.organization_agent_runtime_events
  ADD CONSTRAINT organization_agent_runtime_events_event_type_check CHECK (
    event_type IN (
      'job_queued','job_claimed','plan_recorded','invocation_proposed',
      'invocation_denied','approval_recorded','invocation_claimed',
      'provider_dispatch_started','invocation_completed','run_completed','run_failed',
      'dependency_blocked','dependency_reconciled','agent_promoted'
    )
  );

CREATE FUNCTION tanaghom.claim_agent_skill_invocation_from_adapter(
  p_executor_class text,p_adapter_code text
)
RETURNS TABLE(
  invocation_id uuid,run_id uuid,job_id uuid,organization_id uuid,
  skill_version_id uuid,skill_code text,operation text,channel text,
  parameters jsonb,parameter_hash text,idempotency_key text,
  executor_type text,executor_ref text,executor_version text,
  integration_requirement text,instructions text,input_schema_ref text,
  output_schema_ref text,reference_manifest jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_adapter tanaghom.agent_runtime_executor_adapters%ROWTYPE;
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_code text;
  v_instructions text;
  v_input_schema_ref text;
  v_output_schema_ref text;
  v_reference_manifest jsonb;
BEGIN
  SELECT * INTO v_adapter
    FROM tanaghom.agent_runtime_executor_adapters adapter
   WHERE adapter.code=p_adapter_code
     AND adapter.executor_class=p_executor_class
     AND adapter.enabled;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop=false
  ) THEN RETURN; END IF;

  SELECT invocation.* INTO v_invocation
    FROM tanaghom.organization_agent_invocations invocation
    JOIN tanaghom.organization_agent_runs run ON run.id=invocation.run_id
    JOIN tanaghom.organization_agent_versions version ON version.id=run.agent_version_id
   WHERE invocation.status='ready'
     AND invocation.authorization_status='authorized'
     AND invocation.executor_class=p_executor_class
     AND invocation.executor_ref=ANY(v_adapter.supported_executor_refs)
     AND invocation.operation=ANY(v_adapter.supported_operations)
     AND invocation.simulation_only=false
     AND run.status='dispatching'
     AND (p_executor_class<>'action' OR version.lifecycle_state IN ('assisted','active'))
     AND NOT EXISTS (
       SELECT 1 FROM tanaghom.organization_agent_dependency_blocks block
        WHERE block.organization_id=invocation.organization_id AND block.status='active'
     )
   ORDER BY invocation.proposed_at,invocation.id
   FOR UPDATE OF invocation SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_executor_class='action'
    AND v_invocation.integration_requirement='postiz_private_gateway'
    AND EXISTS (
      SELECT 1 FROM tanaghom.automation_platform_controls
       WHERE provider='postiz' AND emergency_stop
    )
  THEN RETURN; END IF;
  IF p_executor_class='action'
    AND v_invocation.integration_requirement='ghl_private_gateway'
    AND EXISTS (
      SELECT 1 FROM tanaghom.ghl_action_automation_status
       WHERE organization_id=v_invocation.organization_id
         AND (platform_emergency_stop OR action_emergency_stop
           OR NOT connection_ready OR NOT operations_clear)
    )
  THEN RETURN; END IF;

  UPDATE tanaghom.organization_agent_invocations
     SET status='in_progress',started_at=statement_timestamp()
   WHERE id=v_invocation.id RETURNING * INTO v_invocation;
  SELECT definition.code INTO v_code
    FROM tanaghom.skill_versions skill
    JOIN tanaghom.skill_definitions definition ON definition.id=skill.skill_id
   WHERE skill.id=v_invocation.platform_skill_version_id;
  SELECT resolved.instructions,resolved.input_schema_ref,resolved.output_schema_ref,
         resolved.reference_manifest
    INTO v_instructions,v_input_schema_ref,v_output_schema_ref,v_reference_manifest
    FROM tanaghom.resolve_agent_skill_instructions(v_invocation.run_id,v_code) resolved
   WHERE resolved.skill_source='platform';
  IF v_instructions IS NULL THEN
    RAISE EXCEPTION 'authorized invocation lost its exact assigned Skill instructions';
  END IF;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_invocation.organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'invocation_claimed',
    CASE p_executor_class
      WHEN 'read' THEN 'read_executor'
      WHEN 'proposal' THEN 'proposal_executor'
      ELSE 'action_executor'
    END,
    p_adapter_code,
    jsonb_build_object(
      'adapter_code',p_adapter_code,'workflow_id',v_adapter.workflow_id,
      'workflow_version',v_adapter.workflow_version,
      'workflow_sha256',v_adapter.workflow_sha256,
      'executor_class',p_executor_class,'executor_ref',v_invocation.executor_ref,
      'executor_version',v_invocation.executor_version
    )
  );
  RETURN QUERY SELECT
    v_invocation.id,v_invocation.run_id,v_invocation.job_id,v_invocation.organization_id,
    v_invocation.platform_skill_version_id,v_code,v_invocation.operation,v_invocation.channel,
    v_invocation.parameters,v_invocation.parameter_hash,v_invocation.idempotency_key,
    v_invocation.executor_type,v_invocation.executor_ref,v_invocation.executor_version,
    v_invocation.integration_requirement,v_instructions,v_input_schema_ref,
    v_output_schema_ref,v_reference_manifest;
END;
$$;

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
  SELECT * FROM tanaghom.claim_agent_skill_invocation_from_adapter('read',p_worker_ref);
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
  SELECT * FROM tanaghom.claim_agent_skill_invocation_from_adapter('proposal',p_worker_ref);
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
  SELECT * FROM tanaghom.claim_agent_skill_invocation_from_adapter('action',p_worker_ref);
$$;

CREATE FUNCTION tanaghom.begin_agent_runtime_provider_dispatch(
  p_invocation_id uuid,p_parameter_hash text,p_idempotency_key text
)
RETURNS TABLE(
  dispatch_id uuid,invocation_id uuid,organization_id uuid,connection_id uuid,
  provider text,operation text,executor_ref text,parameters jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_connection uuid;
  v_provider text;
  v_dispatch uuid;
BEGIN
  SELECT * INTO v_invocation
    FROM tanaghom.organization_agent_invocations invocation
   WHERE invocation.id=p_invocation_id
     AND invocation.status='in_progress'
     AND invocation.simulation_only=false
     AND invocation.executor_class IN ('read','action')
     AND invocation.parameter_hash=p_parameter_hash
     AND invocation.idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorized claimed provider invocation required'; END IF;
  IF v_invocation.parameters ? 'organization_id'
    AND v_invocation.parameters->>'organization_id'<>v_invocation.organization_id::text
  THEN
    RAISE EXCEPTION 'provider invocation organization parameter is not tenant-bound';
  END IF;
  IF v_invocation.provider_dispatch_id IS NOT NULL THEN
    RAISE EXCEPTION 'provider dispatch already started; reconcile the outcome';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop=false
  ) OR NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_executor_adapters adapter
     WHERE adapter.enabled AND adapter.executor_class=v_invocation.executor_class
       AND v_invocation.executor_ref=ANY(adapter.supported_executor_refs)
       AND v_invocation.operation=ANY(adapter.supported_operations)
  ) THEN
    RAISE EXCEPTION 'provider runtime or exact adapter is disabled';
  END IF;

  v_provider := CASE v_invocation.integration_requirement
    WHEN 'postiz_private_gateway' THEN 'postiz'
    WHEN 'ghl_private_gateway' THEN 'ghl'
    ELSE NULL
  END;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'reviewed provider integration is required'; END IF;
  IF v_provider='postiz' AND EXISTS (
    SELECT 1 FROM tanaghom.automation_platform_controls
     WHERE provider='postiz' AND emergency_stop
  ) THEN RAISE EXCEPTION 'Postiz emergency stop is active'; END IF;
  IF v_provider='ghl' AND EXISTS (
    SELECT 1 FROM tanaghom.ghl_action_automation_status
     WHERE organization_id=v_invocation.organization_id
       AND (platform_emergency_stop OR action_emergency_stop
         OR NOT connection_ready OR NOT operations_clear)
  ) THEN RAISE EXCEPTION 'GHL emergency stop or readiness gate is active'; END IF;

  SELECT connection.id INTO v_connection
    FROM tanaghom.organization_agent_runs run
    JOIN tanaghom.organization_agent_integration_bindings binding
      ON binding.agent_version_id=run.agent_version_id
     AND binding.organization_id=run.organization_id
     AND binding.provider=v_provider
    JOIN tanaghom.integration_connections connection
      ON connection.id=binding.connection_id
     AND connection.organization_id=binding.organization_id
     AND connection.provider=v_provider
     AND connection.status='connected'
     AND connection.last_test_status='passed'
   WHERE run.id=v_invocation.run_id
     AND run.organization_id=v_invocation.organization_id;
  IF v_connection IS NULL THEN RAISE EXCEPTION 'exact connected provider binding is unavailable'; END IF;

  v_dispatch := gen_random_uuid();
  UPDATE tanaghom.organization_agent_invocations
     SET provider_dispatch_id=v_dispatch,
         provider_dispatch_started_at=statement_timestamp()
   WHERE id=v_invocation.id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_invocation.organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'provider_dispatch_started',
    CASE v_invocation.executor_class WHEN 'read' THEN 'read_executor' ELSE 'action_executor' END,
    coalesce(v_invocation.executor_ref,'provider-gateway'),
    jsonb_build_object(
      'dispatch_id',v_dispatch,'provider',v_provider,'operation',v_invocation.operation,
      'parameter_hash',v_invocation.parameter_hash,'idempotency_key',v_invocation.idempotency_key
    )
  );
  RETURN QUERY SELECT
    v_dispatch,v_invocation.id,v_invocation.organization_id,v_connection,
    v_provider,v_invocation.operation,v_invocation.executor_ref,v_invocation.parameters;
END;
$$;

CREATE FUNCTION tanaghom.settle_next_agent_runtime_run(p_worker_ref text)
RETURNS TABLE(run_id uuid,outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_outcome text;
BEGIN
  IF p_worker_ref<>'phase7d_runtime_finalizer_v1' THEN
    RAISE EXCEPTION 'fixed runtime finalizer identity required';
  END IF;
  SELECT run.* INTO v_run
    FROM tanaghom.organization_agent_runs run
    JOIN tanaghom.organization_agent_jobs job ON job.id=run.job_id
   WHERE run.status='dispatching'
     AND job.scenario_id IS NULL
     AND jsonb_array_length(run.plan->'steps')=(
       SELECT count(*) FROM tanaghom.organization_agent_invocations invocation
        WHERE invocation.run_id=run.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM tanaghom.organization_agent_invocations invocation
        WHERE invocation.run_id=run.id
          AND invocation.status IN ('waiting_approval','simulation_ready','ready','in_progress')
     )
   ORDER BY run.started_at,run.id
   FOR UPDATE OF run SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  v_outcome := CASE
    WHEN EXISTS (
      SELECT 1 FROM tanaghom.organization_agent_invocations
       WHERE organization_agent_invocations.run_id=v_run.id AND status='indeterminate'
    ) THEN 'indeterminate'
    WHEN EXISTS (
      SELECT 1 FROM tanaghom.organization_agent_invocations
       WHERE organization_agent_invocations.run_id=v_run.id AND status='failed'
    ) THEN 'failed'
    WHEN EXISTS (
      SELECT 1 FROM tanaghom.organization_agent_invocations
       WHERE organization_agent_invocations.run_id=v_run.id AND status='refused'
    ) THEN 'refused'
    ELSE 'succeeded'
  END;
  PERFORM tanaghom.finalize_agent_runtime_run(
    v_run.id,v_outcome,
    jsonb_build_object(
      'contract_version','phase7.agent-runtime-final-summary.v1',
      'outcome',v_outcome,'settled_by',p_worker_ref
    ),
    NULL
  );
  RETURN QUERY SELECT v_run.id,v_outcome;
END;
$$;

CREATE FUNCTION tanaghom.build_agent_runtime_certification_evidence(
  p_organization_id uuid,p_agent_version_id uuid,p_runtime_profile_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT jsonb_build_object(
    'contract_version','phase7.agent-runtime-certification.v1',
    'organization_id',version.organization_id,
    'agent_version_id',version.id,
    'agent_content_hash',version.content_hash,
    'runtime_profile_id',profile.id,
    'runtime_profile_code',profile.code,
    'languages',to_jsonb(version.languages),
    'required_scenarios_per_language',7,
    'scenario_count',count(scenario.id),
    'external_action_count',coalesce(sum(
      CASE WHEN invocation.provider_reference IS NOT NULL
        OR invocation.provider_dispatch_id IS NOT NULL THEN 1 ELSE 0 END
    ),0),
    'scenarios',jsonb_agg(
      jsonb_build_object(
        'scenario_id',scenario.id,'code',scenario.code,'language',scenario.language,
        'scenario_kind',scenario.scenario_kind,'job_id',job.id,'run_id',run.id,
        'request_fingerprint',job.request_fingerprint,'job_status',job.status,
        'scenario_result',job.scenario_result,'run_status',run.status,
        'invocation_count',(
          SELECT count(*) FROM tanaghom.organization_agent_invocations item
           WHERE item.run_id=run.id
        )
      ) ORDER BY scenario.language,scenario.scenario_kind,scenario.code
    )
  )
  FROM tanaghom.organization_agent_versions version
  JOIN tanaghom.agent_runtime_profiles profile ON profile.id=p_runtime_profile_id
  JOIN tanaghom.organization_agent_test_scenarios scenario
    ON scenario.agent_version_id=version.id
   AND scenario.organization_id=version.organization_id
  JOIN LATERAL (
    SELECT candidate.*
      FROM tanaghom.organization_agent_jobs candidate
     WHERE candidate.scenario_id=scenario.id
       AND candidate.agent_version_id=version.id
       AND candidate.organization_id=version.organization_id
       AND candidate.runtime_profile_id=profile.id
       AND candidate.status='succeeded'
       AND candidate.scenario_result='passed'
     ORDER BY candidate.finished_at DESC,candidate.id
     LIMIT 1
  ) job ON true
  JOIN LATERAL (
    SELECT candidate.*
      FROM tanaghom.organization_agent_runs candidate
     WHERE candidate.job_id=job.id AND candidate.status='succeeded'
     ORDER BY candidate.finished_at DESC,candidate.id
     LIMIT 1
  ) run ON true
  LEFT JOIN tanaghom.organization_agent_invocations invocation ON invocation.run_id=run.id
  WHERE version.id=p_agent_version_id
    AND version.organization_id=p_organization_id
    AND profile.lifecycle_state='validated'
  GROUP BY version.organization_id,version.id,version.content_hash,version.languages,
           profile.id,profile.code;
$$;

CREATE FUNCTION tanaghom.record_agent_runtime_certification_v2(
  p_organization_id uuid,p_agent_version_id uuid,p_runtime_profile_id uuid,
  p_evidence_hash text,p_evidence jsonb,p_operator_ref text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_certification uuid;
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_evidence jsonb;
  v_hash text;
  v_expected_count integer;
BEGIN
  SELECT * INTO v_version FROM tanaghom.organization_agent_versions
   WHERE id=p_agent_version_id AND organization_id=p_organization_id;
  v_evidence := tanaghom.build_agent_runtime_certification_evidence(
    p_organization_id,p_agent_version_id,p_runtime_profile_id
  );
  v_expected_count := cardinality(v_version.languages)*7;
  v_hash := tanaghom.agent_runtime_sha256(v_evidence);
  IF v_version.id IS NULL OR v_version.lifecycle_state<>'validated'
    OR p_operator_ref !~ '^[a-z][a-z0-9._-]{2,79}$'
    OR v_evidence IS NULL
    OR (v_evidence->>'contract_version')<>'phase7.agent-runtime-certification.v1'
    OR (v_evidence->>'scenario_count')::integer<>v_expected_count
    OR jsonb_array_length(v_evidence->'scenarios')<>v_expected_count
    OR (v_evidence->>'external_action_count')::integer<>0
    OR p_evidence IS DISTINCT FROM v_evidence
    OR p_evidence_hash IS DISTINCT FROM v_hash
    OR EXISTS (
      SELECT language,scenario_kind
        FROM tanaghom.organization_agent_test_scenarios
       WHERE agent_version_id=p_agent_version_id
       GROUP BY language,scenario_kind HAVING count(*)<>1
    )
    OR EXISTS (
      SELECT 1
        FROM tanaghom.organization_agent_test_scenarios scenario
       WHERE scenario.agent_version_id=p_agent_version_id
         AND NOT scenario.language=ANY(v_version.languages)
    )
    OR EXISTS (
      SELECT 1
        FROM tanaghom.organization_agent_jobs job
        JOIN tanaghom.organization_agent_invocations invocation ON invocation.job_id=job.id
       WHERE job.agent_version_id=p_agent_version_id
         AND job.scenario_result='passed'
         AND (
           invocation.simulation_only=false
           OR invocation.actual_cost<>0
           OR invocation.provider_reference IS NOT NULL
           OR invocation.provider_dispatch_id IS NOT NULL
         )
    )
  THEN
    RAISE EXCEPTION 'exact complete zero-action runtime certification evidence is required';
  END IF;
  INSERT INTO tanaghom.organization_agent_runtime_certifications (
    organization_id,agent_version_id,runtime_profile_id,evidence_hash,evidence,certified_by
  ) VALUES (
    p_organization_id,p_agent_version_id,p_runtime_profile_id,v_hash,v_evidence,p_operator_ref
  ) RETURNING id INTO v_certification;
  RETURN v_certification;
END;
$$;

REVOKE ALL ON tanaghom.agent_runtime_executor_adapters FROM PUBLIC;
REVOKE ALL ON tanaghom.agent_runtime_executor_adapter_events FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.enforce_agent_runtime_executor_adapter_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.set_agent_runtime_executor_adapter(text,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_agent_skill_invocation_from_adapter(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.enforce_agent_runtime_provider_dispatch_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.begin_agent_runtime_provider_dispatch(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.settle_next_agent_runtime_run(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_agent_runtime_certification_v2(uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION tanaghom.record_agent_runtime_certification(uuid,uuid,uuid,text,jsonb,text)
  FROM tanaghom_agent_runtime;

GRANT EXECUTE ON FUNCTION tanaghom.begin_agent_runtime_provider_dispatch(uuid,text,text)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.settle_next_agent_runtime_run(text)
  TO tanaghom_agent_runtime;
GRANT EXECUTE ON FUNCTION tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)
  TO tanaghom_agent_runtime;
GRANT EXECUTE ON FUNCTION tanaghom.record_agent_runtime_certification_v2(uuid,uuid,uuid,text,jsonb,text)
  TO tanaghom_agent_runtime;

INSERT INTO public.schema_migrations(version)
VALUES ('0031_policy_runtime_executors_certification');

COMMIT;
