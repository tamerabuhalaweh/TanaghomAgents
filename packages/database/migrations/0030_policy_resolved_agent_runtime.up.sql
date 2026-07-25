BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_agent_runtime') THEN
    CREATE ROLE tanaghom_agent_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_skill_read_executor') THEN
    CREATE ROLE tanaghom_skill_read_executor
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_skill_proposal_executor') THEN
    CREATE ROLE tanaghom_skill_proposal_executor
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_skill_action_executor') THEN
    CREATE ROLE tanaghom_skill_action_executor
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA tanaghom TO
  tanaghom_agent_runtime,
  tanaghom_skill_read_executor,
  tanaghom_skill_proposal_executor,
  tanaghom_skill_action_executor;

CREATE TABLE tanaghom.agent_runtime_profiles (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  model_name text NOT NULL CHECK (length(trim(model_name)) BETWEEN 3 AND 120),
  planner_contract_version text NOT NULL
    CHECK (planner_contract_version='phase7.agent-runtime-plan.v1'),
  planner_schema_ref text NOT NULL
    CHECK (planner_schema_ref='packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json'),
  planner_schema_hash text NOT NULL CHECK (planner_schema_hash ~ '^[a-f0-9]{64}$'),
  prompt_version text NOT NULL CHECK (prompt_version='policy-resolved-agent.v1'),
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  parser_version text NOT NULL CHECK (parser_version='tanaghom.strict-json.v1'),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('validated','retired')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE tanaghom.agent_runtime_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  emergency_stop boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  max_global_concurrency integer NOT NULL CHECK (max_global_concurrency BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE tanaghom.organization_agent_runtime_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  agent_version_id uuid NOT NULL,
  runtime_profile_id uuid NOT NULL REFERENCES tanaghom.agent_runtime_profiles(id) ON DELETE RESTRICT,
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^sha256:[a-f0-9]{64}$'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  certified_by text NOT NULL CHECK (certified_by ~ '^[a-z][a-z0-9._-]{2,79}$'),
  certified_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (agent_version_id,runtime_profile_id,evidence_hash)
);

CREATE TABLE tanaghom.organization_agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  agent_version_id uuid NOT NULL,
  runtime_profile_id uuid NOT NULL REFERENCES tanaghom.agent_runtime_profiles(id) ON DELETE RESTRICT,
  scenario_id uuid REFERENCES tanaghom.organization_agent_test_scenarios(id) ON DELETE RESTRICT,
  parent_job_id uuid REFERENCES tanaghom.organization_agent_jobs(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 200
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
  ),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  source_kind text NOT NULL CHECK (source_kind IN ('scenario','human_request','agent_handoff')),
  handoff_contract_version text CHECK (
    handoff_contract_version IS NULL
    OR handoff_contract_version='phase7.agent-handoff.v1'
  ),
  handoff_attestation text CHECK (
    handoff_attestation IS NULL OR handoff_attestation ~ '^sha256:[a-f0-9]{64}$'
  ),
  channel text CHECK (channel IS NULL OR channel IN (
    'email','facebook','instagram','linkedin','live_chat','sms',
    'tiktok','whatsapp','x','youtube'
  )),
  consent_verified boolean NOT NULL DEFAULT false,
  language text NOT NULL CHECK (language IN ('en','ar')),
  input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
  requested_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','running','waiting_approval','succeeded','refused',
    'failed','cancelled','indeterminate'
  )),
  scenario_result text CHECK (
    scenario_result IS NULL OR scenario_result IN ('passed','failed')
  ),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 6),
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (organization_id,idempotency_key),
  UNIQUE (organization_id,id),
  CHECK (
    (status IN ('succeeded','refused','failed','cancelled','indeterminate')
      AND finished_at IS NOT NULL)
    OR status NOT IN ('succeeded','refused','failed','cancelled','indeterminate')
  ),
  CHECK (
    (source_kind='agent_handoff' AND parent_job_id IS NOT NULL
      AND handoff_contract_version IS NOT NULL AND handoff_attestation IS NOT NULL)
    OR
    (source_kind<>'agent_handoff' AND parent_job_id IS NULL
      AND handoff_contract_version IS NULL AND handoff_attestation IS NULL)
  )
);

CREATE INDEX organization_agent_jobs_claim_idx
  ON tanaghom.organization_agent_jobs(status,available_at,created_at)
  WHERE status='queued';

CREATE TABLE tanaghom.organization_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job_id uuid NOT NULL,
  run_number integer NOT NULL CHECK (run_number BETWEEN 1 AND 6),
  agent_version_id uuid NOT NULL,
  runtime_profile_id uuid NOT NULL REFERENCES tanaghom.agent_runtime_profiles(id) ON DELETE RESTRICT,
  agent_content_hash text NOT NULL CHECK (agent_content_hash ~ '^sha256:[a-f0-9]{64}$'),
  resolved_context jsonb NOT NULL CHECK (jsonb_typeof(resolved_context)='object'),
  plan jsonb CHECK (plan IS NULL OR jsonb_typeof(plan)='object'),
  plan_hash text CHECK (plan_hash IS NULL OR plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN (
    'planning','authorizing','dispatching','waiting_approval',
    'succeeded','refused','failed','cancelled','indeterminate'
  )),
  tool_call_count integer NOT NULL DEFAULT 0 CHECK (tool_call_count BETWEEN 0 AND 20),
  prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens BETWEEN 0 AND 32000),
  completion_tokens integer NOT NULL DEFAULT 0 CHECK (completion_tokens BETWEEN 0 AND 32000),
  actual_cost numeric(12,4) NOT NULL DEFAULT 0 CHECK (actual_cost BETWEEN 0 AND 1000000),
  started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id,job_id)
    REFERENCES tanaghom.organization_agent_jobs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (job_id,run_number),
  UNIQUE (organization_id,id)
);

CREATE TABLE tanaghom.organization_agent_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 20),
  requested_skill_code text NOT NULL CHECK (requested_skill_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  skill_binding_id uuid REFERENCES tanaghom.organization_agent_skill_bindings(id) ON DELETE RESTRICT,
  platform_skill_version_id uuid REFERENCES tanaghom.skill_versions(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9._-]{1,79}$'),
  channel text CHECK (channel IS NULL OR channel IN (
    'email','facebook','instagram','linkedin','live_chat','sms',
    'tiktok','whatsapp','x','youtube'
  )),
  consent_evidence text NOT NULL CHECK (
    consent_evidence IN ('verified','not_required','missing')
  ),
  parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters)='object'),
  parameter_hash text NOT NULL CHECK (parameter_hash ~ '^sha256:[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 200
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
  ),
  authorization_status text NOT NULL CHECK (
    authorization_status IN ('authorized','denied','waiting_approval')
  ),
  denial_reason text,
  executor_class text CHECK (executor_class IS NULL OR executor_class IN ('read','proposal','action')),
  executor_type text,
  executor_ref text,
  executor_version text,
  integration_requirement text,
  simulation_only boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN (
    'refused','waiting_approval','simulation_ready','ready','in_progress',
    'succeeded','failed','cancelled','indeterminate'
  )),
  result_summary jsonb CHECK (result_summary IS NULL OR jsonb_typeof(result_summary)='object'),
  provider_reference text,
  prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens BETWEEN 0 AND 32000),
  completion_tokens integer NOT NULL DEFAULT 0 CHECK (completion_tokens BETWEEN 0 AND 32000),
  actual_cost numeric(12,4) NOT NULL DEFAULT 0 CHECK (actual_cost BETWEEN 0 AND 1000000),
  proposed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  authorized_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (organization_id,run_id)
    REFERENCES tanaghom.organization_agent_runs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,job_id)
    REFERENCES tanaghom.organization_agent_jobs(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (organization_id,idempotency_key),
  UNIQUE (run_id,sequence),
  UNIQUE (organization_id,id)
);

CREATE INDEX organization_agent_invocations_claim_idx
  ON tanaghom.organization_agent_invocations(executor_class,status,proposed_at)
  WHERE status IN ('simulation_ready','ready');

CREATE TABLE tanaghom.organization_agent_invocation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invocation_id uuid NOT NULL,
  parameter_hash text NOT NULL CHECK (parameter_hash ~ '^sha256:[a-f0-9]{64}$'),
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  decided_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,invocation_id)
    REFERENCES tanaghom.organization_agent_invocations(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (invocation_id)
);

CREATE TABLE tanaghom.organization_agent_dependency_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  invocation_id uuid NOT NULL,
  integration_requirement text NOT NULL CHECK (
    integration_requirement IN ('postiz_private_gateway','ghl_private_gateway')
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reconciled')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  reconciled_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  reconciled_at timestamptz,
  resolution text,
  FOREIGN KEY (organization_id,invocation_id)
    REFERENCES tanaghom.organization_agent_invocations(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (invocation_id),
  CHECK (
    (status='reconciled' AND reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL
      AND length(trim(coalesce(resolution,''))) BETWEEN 3 AND 1000)
    OR (status='active' AND reconciled_by IS NULL AND reconciled_at IS NULL AND resolution IS NULL)
  )
);

CREATE TABLE tanaghom.organization_agent_runtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  job_id uuid,
  run_id uuid,
  invocation_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'job_queued','job_claimed','plan_recorded','invocation_proposed',
    'invocation_denied','approval_recorded','invocation_claimed',
    'invocation_completed','run_completed','run_failed',
    'dependency_blocked','dependency_reconciled','agent_promoted'
  )),
  actor_kind text NOT NULL CHECK (
    actor_kind IN ('human','runtime','read_executor','proposal_executor','action_executor','platform_operator')
  ),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) BETWEEN 3 AND 120),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,job_id)
    REFERENCES tanaghom.organization_agent_jobs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,run_id)
    REFERENCES tanaghom.organization_agent_runs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,invocation_id)
    REFERENCES tanaghom.organization_agent_invocations(organization_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION tanaghom.prevent_agent_runtime_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent runtime evidence is append-only';
END;
$$;

CREATE TRIGGER agent_runtime_profile_immutable
BEFORE UPDATE OR DELETE ON tanaghom.agent_runtime_profiles
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_agent_runtime_append_only_mutation();
CREATE TRIGGER agent_runtime_certification_immutable
BEFORE UPDATE OR DELETE ON tanaghom.organization_agent_runtime_certifications
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_agent_runtime_append_only_mutation();
CREATE TRIGGER agent_runtime_approval_immutable
BEFORE UPDATE OR DELETE ON tanaghom.organization_agent_invocation_approvals
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_agent_runtime_append_only_mutation();
CREATE TRIGGER agent_runtime_event_immutable
BEFORE UPDATE OR DELETE ON tanaghom.organization_agent_runtime_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_agent_runtime_append_only_mutation();

CREATE FUNCTION tanaghom.enforce_agent_runtime_job_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'agent runtime jobs are durable';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.agent_version_id IS DISTINCT FROM OLD.agent_version_id
    OR NEW.runtime_profile_id IS DISTINCT FROM OLD.runtime_profile_id
    OR NEW.scenario_id IS DISTINCT FROM OLD.scenario_id
    OR NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.consent_verified IS DISTINCT FROM OLD.consent_verified
    OR NEW.language IS DISTINCT FROM OLD.language
    OR NEW.input IS DISTINCT FROM OLD.input
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
  ) THEN
    RAISE EXCEPTION 'agent runtime job request is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_job_integrity
BEFORE UPDATE OR DELETE ON tanaghom.organization_agent_jobs
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_agent_runtime_job_integrity();

CREATE FUNCTION tanaghom.enforce_agent_runtime_invocation_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'agent runtime invocations are durable';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.sequence IS DISTINCT FROM OLD.sequence
    OR NEW.requested_skill_code IS DISTINCT FROM OLD.requested_skill_code
    OR NEW.skill_binding_id IS DISTINCT FROM OLD.skill_binding_id
    OR NEW.platform_skill_version_id IS DISTINCT FROM OLD.platform_skill_version_id
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.consent_evidence IS DISTINCT FROM OLD.consent_evidence
    OR NEW.parameters IS DISTINCT FROM OLD.parameters
    OR NEW.parameter_hash IS DISTINCT FROM OLD.parameter_hash
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.executor_class IS DISTINCT FROM OLD.executor_class
    OR NEW.executor_type IS DISTINCT FROM OLD.executor_type
    OR NEW.executor_ref IS DISTINCT FROM OLD.executor_ref
    OR NEW.executor_version IS DISTINCT FROM OLD.executor_version
    OR NEW.integration_requirement IS DISTINCT FROM OLD.integration_requirement
    OR NEW.simulation_only IS DISTINCT FROM OLD.simulation_only
  ) THEN
    RAISE EXCEPTION 'agent runtime invocation request is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_invocation_integrity
BEFORE UPDATE OR DELETE ON tanaghom.organization_agent_invocations
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_agent_runtime_invocation_integrity();

INSERT INTO tanaghom.agent_runtime_profiles (
  id,code,model_name,planner_contract_version,planner_schema_ref,planner_schema_hash,
  prompt_version,prompt_hash,parser_version,lifecycle_state
) VALUES (
  '7d000000-0000-4000-8000-000000000001',
  'gemma4_vllm_strict_v1',
  'gemma4-vllm',
  'phase7.agent-runtime-plan.v1',
  'packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json',
  'cc0e96f25505bf4251fc66e317a22e1a4a7e417cf08b5827aa270268f89b5178',
  'policy-resolved-agent.v1',
  'ea65fca6fc3759a89c140a73e01057d90d25475b891e0473ee0fa721c6382485',
  'tanaghom.strict-json.v1',
  'validated'
);

INSERT INTO tanaghom.agent_runtime_controls (
  singleton,emergency_stop,reason,max_global_concurrency
) VALUES (
  true,true,'Awaiting reviewed shared-runtime deployment and simulation evidence',8
);

CREATE FUNCTION tanaghom.agent_runtime_json_is_safe(p_value jsonb,p_max_bytes integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_value IS NOT NULL
     AND jsonb_typeof(p_value)='object'
     AND octet_length(p_value::text) BETWEEN 2 AND p_max_bytes
     AND p_value::text !~* '-----BEGIN [A-Z ]*PRIVATE KEY-----'
     AND p_value::text !~* '(^|[^a-z])(api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)[[:space:]]*[:=]'
     AND p_value::text !~* '(^|[^a-z])bearer[[:space:]]+[a-z0-9._-]{8,}';
$$;

CREATE FUNCTION tanaghom.agent_runtime_sha256(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path=pg_catalog,pg_temp,extensions,public
AS $$
  SELECT 'sha256:'||encode(digest(p_value::text,'sha256'),'hex');
$$;

CREATE FUNCTION tanaghom.queue_organization_agent_job(
  p_organization_id uuid,
  p_actor_id uuid,
  p_agent_version_id uuid,
  p_runtime_profile_id uuid,
  p_scenario_id uuid,
  p_parent_job_id uuid,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_source_kind text,
  p_channel text,
  p_consent_verified boolean,
  p_language text,
  p_input jsonb
)
RETURNS TABLE(job_id uuid,status text,created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_existing tanaghom.organization_agent_jobs%ROWTYPE;
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_job tanaghom.organization_agent_jobs%ROWTYPE;
  v_request_fingerprint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=p_actor_id AND organization_id=p_organization_id
       AND kind='human' AND role IN ('owner','operator')
       AND is_active=true AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'accepted active organization owner or operator required';
  END IF;
  IF p_correlation_id IS NULL
    OR p_idempotency_key IS NULL
    OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
    OR p_request_fingerprint !~ '^sha256:[a-f0-9]{64}$'
    OR p_source_kind NOT IN ('scenario','human_request','agent_handoff')
    OR p_language NOT IN ('en','ar')
    OR NOT tanaghom.agent_runtime_json_is_safe(p_input,65536)
  THEN
    RAISE EXCEPTION 'invalid policy-resolved agent job contract';
  END IF;
  IF p_source_kind='agent_handoff' OR p_parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'agent handoffs require the server-attested runtime function';
  END IF;
  v_request_fingerprint := tanaghom.agent_runtime_sha256(p_input);

  SELECT * INTO v_existing FROM tanaghom.organization_agent_jobs
   WHERE organization_id=p_organization_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_request_fingerprint
      OR v_existing.agent_version_id IS DISTINCT FROM p_agent_version_id
      OR v_existing.input IS DISTINCT FROM p_input
    THEN
      RAISE EXCEPTION 'agent job idempotency conflict';
    END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.status,false;
    RETURN;
  END IF;

  SELECT * INTO v_version FROM tanaghom.organization_agent_versions
   WHERE id=p_agent_version_id AND organization_id=p_organization_id;
  IF NOT FOUND
    OR v_version.lifecycle_state NOT IN ('validated','simulation','shadow','assisted','active')
    OR NOT p_language=ANY(v_version.languages)
  THEN
    RAISE EXCEPTION 'unknown, disabled, or incompatible organization agent version';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_profiles
     WHERE id=p_runtime_profile_id AND lifecycle_state='validated'
  ) THEN
    RAISE EXCEPTION 'validated runtime profile required';
  END IF;
  IF v_version.lifecycle_state='validated' AND p_scenario_id IS NULL THEN
    RAISE EXCEPTION 'validated agents accept mandatory scenario jobs only';
  END IF;
  IF (p_source_kind='scenario') IS DISTINCT FROM (p_scenario_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scenario source and scenario identity must match';
  END IF;
  IF p_scenario_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_test_scenarios
     WHERE id=p_scenario_id AND organization_id=p_organization_id
       AND agent_version_id=p_agent_version_id AND language=p_language
  ) THEN
    RAISE EXCEPTION 'cross-tenant or mismatched agent scenario';
  END IF;
  INSERT INTO tanaghom.organization_agent_jobs (
    organization_id,agent_version_id,runtime_profile_id,scenario_id,parent_job_id,
    correlation_id,idempotency_key,request_fingerprint,source_kind,channel,
    consent_verified,language,input,requested_by
  ) VALUES (
    p_organization_id,p_agent_version_id,p_runtime_profile_id,p_scenario_id,p_parent_job_id,
    p_correlation_id,p_idempotency_key,v_request_fingerprint,p_source_kind,p_channel,
    coalesce(p_consent_verified,false),p_language,p_input,p_actor_id
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    p_organization_id,v_job.id,'job_queued','human',p_actor_id::text,
    jsonb_build_object(
      'agent_version_id',p_agent_version_id,
      'runtime_profile_id',p_runtime_profile_id,
      'source_kind',p_source_kind,
      'request_fingerprint',v_request_fingerprint,
      'idempotency_key',p_idempotency_key
    )
  );
  RETURN QUERY SELECT v_job.id,v_job.status,true;
END;
$$;

CREATE FUNCTION tanaghom.queue_organization_agent_handoff(
  p_parent_job_id uuid,p_target_agent_version_id uuid,p_runtime_profile_id uuid,
  p_idempotency_key text,p_language text,p_channel text,
  p_consent_verified boolean,p_input jsonb
)
RETURNS TABLE(job_id uuid,status text,created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_parent tanaghom.organization_agent_jobs%ROWTYPE;
  v_target tanaghom.organization_agent_versions%ROWTYPE;
  v_existing tanaghom.organization_agent_jobs%ROWTYPE;
  v_job tanaghom.organization_agent_jobs%ROWTYPE;
  v_fingerprint text;
  v_attestation text;
BEGIN
  IF p_idempotency_key IS NULL
    OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
    OR p_language NOT IN ('en','ar')
    OR NOT tanaghom.agent_runtime_json_is_safe(p_input,65536)
  THEN
    RAISE EXCEPTION 'invalid server-attested agent handoff contract';
  END IF;
  SELECT * INTO v_parent FROM tanaghom.organization_agent_jobs
   WHERE id=p_parent_job_id AND status='succeeded' FOR SHARE;
  SELECT * INTO v_target FROM tanaghom.organization_agent_versions
   WHERE id=p_target_agent_version_id
     AND organization_id=v_parent.organization_id
     AND agent_id<>(
       SELECT agent_id FROM tanaghom.organization_agent_versions
        WHERE id=v_parent.agent_version_id
     );
  IF v_parent.id IS NULL OR v_target.id IS NULL
    OR v_target.lifecycle_state NOT IN ('simulation','shadow','assisted','active')
    OR NOT p_language=ANY(v_target.languages)
    OR NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_profiles
       WHERE id=p_runtime_profile_id AND lifecycle_state='validated'
    )
  THEN
    RAISE EXCEPTION 'successful tenant-bound parent and enabled target agent required';
  END IF;
  v_fingerprint := tanaghom.agent_runtime_sha256(p_input);
  v_attestation := tanaghom.agent_runtime_sha256(jsonb_build_object(
    'contract_version','phase7.agent-handoff.v1',
    'organization_id',v_parent.organization_id,
    'parent_job_id',v_parent.id,
    'parent_agent_version_id',v_parent.agent_version_id,
    'target_agent_version_id',v_target.id,
    'runtime_profile_id',p_runtime_profile_id,
    'correlation_id',v_parent.correlation_id,
    'request_fingerprint',v_fingerprint
  ));
  SELECT * INTO v_existing FROM tanaghom.organization_agent_jobs
   WHERE organization_id=v_parent.organization_id
     AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.parent_job_id IS DISTINCT FROM v_parent.id
      OR v_existing.agent_version_id IS DISTINCT FROM v_target.id
      OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint
      OR v_existing.handoff_attestation IS DISTINCT FROM v_attestation
    THEN
      RAISE EXCEPTION 'agent handoff idempotency conflict';
    END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.status,false;
    RETURN;
  END IF;
  INSERT INTO tanaghom.organization_agent_jobs (
    organization_id,agent_version_id,runtime_profile_id,parent_job_id,
    correlation_id,idempotency_key,request_fingerprint,source_kind,
    handoff_contract_version,handoff_attestation,channel,consent_verified,
    language,input,requested_by
  ) VALUES (
    v_parent.organization_id,v_target.id,p_runtime_profile_id,v_parent.id,
    v_parent.correlation_id,p_idempotency_key,v_fingerprint,'agent_handoff',
    'phase7.agent-handoff.v1',v_attestation,p_channel,
    coalesce(p_consent_verified,false),p_language,p_input,v_parent.requested_by
  ) RETURNING * INTO v_job;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_job.organization_id,v_job.id,'job_queued','runtime','shared-runner',
    jsonb_build_object(
      'source_kind','agent_handoff','parent_job_id',v_parent.id,
      'target_agent_version_id',v_target.id,
      'contract_version',v_job.handoff_contract_version,
      'handoff_attestation',v_job.handoff_attestation,
      'request_fingerprint',v_job.request_fingerprint
    )
  );
  RETURN QUERY SELECT v_job.id,v_job.status,true;
END;
$$;

CREATE FUNCTION tanaghom.claim_organization_agent_job(p_worker_ref text)
RETURNS TABLE(job_id uuid,run_id uuid,lease_token uuid,planner_context jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_job tanaghom.organization_agent_jobs%ROWTYPE;
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_policy tanaghom.organization_agent_policies%ROWTYPE;
  v_profile tanaghom.agent_runtime_profiles%ROWTYPE;
  v_context jsonb;
  v_skills jsonb;
  v_lease uuid := gen_random_uuid();
BEGIN
  IF p_worker_ref !~ '^[a-z][a-z0-9._-]{2,79}$' THEN
    RAISE EXCEPTION 'stable runtime worker identity required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop=false
  ) THEN
    RETURN;
  END IF;
  IF (
    SELECT count(*) FROM tanaghom.organization_agent_jobs WHERE status='running'
  ) >= (
    SELECT max_global_concurrency FROM tanaghom.agent_runtime_controls WHERE singleton
  ) THEN
    RETURN;
  END IF;

  SELECT job.* INTO v_job
    FROM tanaghom.organization_agent_jobs job
    JOIN tanaghom.organization_agent_versions version
      ON version.id=job.agent_version_id AND version.organization_id=job.organization_id
    JOIN tanaghom.organization_agent_policies policy
      ON policy.agent_version_id=version.id AND policy.organization_id=version.organization_id
    JOIN tanaghom.agent_runtime_profiles profile
      ON profile.id=job.runtime_profile_id AND profile.lifecycle_state='validated'
   WHERE job.status='queued' AND job.available_at<=statement_timestamp()
     AND (
       version.lifecycle_state IN ('simulation','shadow','assisted','active')
       OR (version.lifecycle_state='validated' AND job.scenario_id IS NOT NULL)
     )
     AND NOT EXISTS (
       SELECT 1 FROM tanaghom.organization_agent_dependency_blocks block
        WHERE block.organization_id=job.organization_id AND block.status='active'
     )
     AND (
       SELECT count(*) FROM tanaghom.organization_agent_jobs concurrent
        WHERE concurrent.agent_version_id=job.agent_version_id
          AND concurrent.status='running'
     ) < policy.max_concurrency
     AND NOT EXISTS (
       SELECT 1
         FROM tanaghom.organization_agent_skill_bindings binding
         LEFT JOIN tanaghom.skill_versions platform_skill
           ON binding.skill_source='platform'
          AND platform_skill.id=binding.platform_skill_version_id
         LEFT JOIN tanaghom.organization_skill_versions organization_skill
           ON binding.skill_source='organization'
          AND organization_skill.id=binding.organization_skill_version_id
        WHERE binding.agent_version_id=job.agent_version_id
          AND (
            (binding.skill_source='platform' AND platform_skill.lifecycle_state<>'published')
            OR
            (binding.skill_source='organization' AND organization_skill.lifecycle_state<>'published')
          )
     )
     AND EXISTS (
       SELECT 1
         FROM tanaghom.organization_agent_skill_bindings binding
         LEFT JOIN tanaghom.skill_versions platform_skill
           ON binding.skill_source='platform'
          AND platform_skill.id=binding.platform_skill_version_id
         LEFT JOIN tanaghom.organization_skill_versions organization_skill
           ON binding.skill_source='organization'
          AND organization_skill.id=binding.organization_skill_version_id
        WHERE binding.agent_version_id=job.agent_version_id
          AND binding.operating_mode<>'disabled'
          AND (
            (binding.skill_source='platform' AND platform_skill.lifecycle_state='published')
            OR
            (binding.skill_source='organization' AND organization_skill.lifecycle_state='published')
          )
     )
   ORDER BY job.available_at,job.created_at,job.id
   FOR UPDATE OF job SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_version FROM tanaghom.organization_agent_versions WHERE id=v_job.agent_version_id;
  SELECT * INTO v_policy FROM tanaghom.organization_agent_policies WHERE agent_version_id=v_job.agent_version_id;
  SELECT * INTO v_profile FROM tanaghom.agent_runtime_profiles WHERE id=v_job.runtime_profile_id;

  SELECT coalesce(jsonb_agg(skill ORDER BY skill->>'code'),'[]'::jsonb)
    INTO v_skills
    FROM (
      SELECT jsonb_build_object(
        'code',definition.code,
        'name',definition.name,
        'description',definition.description,
        'source','platform',
        'executable',true,
        'version_id',skill.id,
        'version_number',skill.version_number,
        'risk_class',skill.risk_class,
        'side_effect_class',skill.side_effect_class,
        'operations',skill.permission_manifest->'operations',
        'channels',skill.permission_manifest->'channels',
        'operating_mode',binding.operating_mode,
        'approval_required',binding.approval_required
      ) AS skill
        FROM tanaghom.organization_agent_skill_bindings binding
        JOIN tanaghom.skill_versions skill ON skill.id=binding.platform_skill_version_id
        JOIN tanaghom.skill_definitions definition ON definition.id=skill.skill_id
       WHERE binding.agent_version_id=v_job.agent_version_id
         AND binding.skill_source='platform'
         AND skill.lifecycle_state='published'
         AND binding.operating_mode<>'disabled'
      UNION ALL
      SELECT jsonb_build_object(
        'code',definition.code,
        'name',skill.display_name,
        'description',skill.description,
        'source','organization',
        'executable',false,
        'version_id',skill.id,
        'version_number',skill.version_number,
        'risk_class','bounded_instruction',
        'side_effect_class','none',
        'operations','[]'::jsonb,
        'channels','[]'::jsonb,
        'operating_mode',binding.operating_mode,
        'approval_required',binding.approval_required
      ) AS skill
        FROM tanaghom.organization_agent_skill_bindings binding
        JOIN tanaghom.organization_skill_versions skill
          ON skill.id=binding.organization_skill_version_id
        JOIN tanaghom.organization_skill_definitions definition ON definition.id=skill.skill_id
       WHERE binding.agent_version_id=v_job.agent_version_id
         AND binding.skill_source='organization'
         AND skill.lifecycle_state='published'
         AND binding.operating_mode<>'disabled'
    ) catalog;

  v_context := jsonb_build_object(
    'contract_version','phase7.agent-runtime-context.v1',
    'platform_safety',jsonb_build_object(
      'model_output_is_authority',false,
      'arbitrary_code_allowed',false,
      'arbitrary_url_allowed',false,
      'direct_sql_allowed',false,
      'credentials_disclosed',false
    ),
    'organization_id',v_job.organization_id,
    'job',jsonb_build_object(
      'id',v_job.id,'correlation_id',v_job.correlation_id,
      'source_kind',v_job.source_kind,'language',v_job.language,
      'channel',v_job.channel,'consent_verified',v_job.consent_verified,
      'untrusted_input',v_job.input
    ),
    'agent',jsonb_build_object(
      'version_id',v_version.id,'content_hash',v_version.content_hash,
      'display_name',v_version.display_name,'objective',v_version.objective,
      'responsibility',v_version.responsibility,'tone',v_version.tone,
      'languages',v_version.languages,'knowledge_keys',v_version.knowledge_keys,
      'lifecycle_state',v_version.lifecycle_state
    ),
    'policy',jsonb_build_object(
      'business_timezone',v_policy.business_timezone,
      'business_hours',v_policy.business_hours,
      'allowed_channels',v_policy.allowed_channels,
      'consent_required',v_policy.consent_required,
      'max_steps',v_policy.max_steps,
      'max_tool_calls',v_policy.max_tool_calls,
      'max_retries',v_policy.max_retries,
      'max_runtime_seconds',v_policy.max_runtime_seconds,
      'max_tokens',v_policy.max_tokens,
      'max_daily_actions',v_policy.max_daily_actions,
      'max_actions_per_minute',v_policy.max_actions_per_minute,
      'monthly_budget',v_policy.monthly_budget,
      'allowed_record_types',v_policy.allowed_record_types,
      'allowed_action_types',v_policy.allowed_action_types,
      'approval_actions',v_policy.approval_actions,
      'approval_roles',v_policy.approval_roles,
      'parameter_bound_approval',v_policy.parameter_bound_approval,
      'escalation_conditions',v_policy.escalation_conditions
    ),
    'skill_catalog',v_skills,
    'runtime_profile',jsonb_build_object(
      'id',v_profile.id,'code',v_profile.code,'model_name',v_profile.model_name,
      'planner_contract_version',v_profile.planner_contract_version,
      'planner_schema_ref',v_profile.planner_schema_ref,
      'planner_schema_hash',v_profile.planner_schema_hash,
      'prompt_version',v_profile.prompt_version,'prompt_hash',v_profile.prompt_hash,
      'parser_version',v_profile.parser_version
    )
  );

  UPDATE tanaghom.organization_agent_jobs
     SET status='running',attempt=attempt+1,lease_token=v_lease,
         lease_expires_at=statement_timestamp()+make_interval(secs=>v_policy.max_runtime_seconds),
         started_at=coalesce(started_at,statement_timestamp()),
         updated_at=statement_timestamp()
   WHERE id=v_job.id
   RETURNING * INTO v_job;

  INSERT INTO tanaghom.organization_agent_runs (
    organization_id,job_id,run_number,agent_version_id,runtime_profile_id,
    agent_content_hash,resolved_context
  ) VALUES (
    v_job.organization_id,v_job.id,v_job.attempt,v_job.agent_version_id,
    v_job.runtime_profile_id,v_version.content_hash,v_context
  ) RETURNING * INTO v_run;

  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_job.organization_id,v_job.id,v_run.id,'job_claimed','runtime',p_worker_ref,
    jsonb_build_object(
      'agent_version_id',v_job.agent_version_id,
      'runtime_profile_id',v_job.runtime_profile_id,
      'lease_expires_at',v_job.lease_expires_at
    )
  );
  RETURN QUERY SELECT v_job.id,v_run.id,v_lease,v_context;
END;
$$;

CREATE FUNCTION tanaghom.resolve_agent_skill_instructions(
  p_run_id uuid,p_skill_code text
)
RETURNS TABLE(
  skill_source text,skill_version_id uuid,instructions text,
  input_schema_ref text,output_schema_ref text,reference_manifest jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_run tanaghom.organization_agent_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM tanaghom.organization_agent_runs
   WHERE id=p_run_id AND status IN ('planning','authorizing','dispatching','waiting_approval');
  IF NOT FOUND THEN RAISE EXCEPTION 'active tenant-bound agent run required'; END IF;

  RETURN QUERY
  SELECT 'platform'::text,skill.id,skill.instructions,
         skill.input_schema_ref,skill.output_schema_ref,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'type',reference.reference_type,
             'path',reference.reference_path,
             'content_hash',reference.content_hash
           ) ORDER BY reference.reference_type,reference.reference_path)
             FROM tanaghom.skill_references reference
            WHERE reference.skill_version_id=skill.id
         ),'[]'::jsonb)
    FROM tanaghom.organization_agent_skill_bindings binding
    JOIN tanaghom.skill_versions skill ON skill.id=binding.platform_skill_version_id
    JOIN tanaghom.skill_definitions definition ON definition.id=skill.skill_id
   WHERE binding.agent_version_id=v_run.agent_version_id
     AND binding.organization_id=v_run.organization_id
     AND binding.skill_source='platform'
     AND binding.operating_mode<>'disabled'
     AND skill.lifecycle_state='published'
     AND definition.code=p_skill_code
  UNION ALL
  SELECT 'organization'::text,skill.id,skill.instructions,
         NULL::text,NULL::text,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'type',reference.reference_type,
             'key',reference.reference_key,
             'title',reference.title,
             'language',reference.language,
             'content_hash',reference.content_hash
           ) ORDER BY reference.reference_type,reference.reference_key)
             FROM tanaghom.organization_skill_references reference
            WHERE reference.skill_version_id=skill.id
              AND (reference.expires_at IS NULL OR reference.expires_at>statement_timestamp())
         ),'[]'::jsonb)
    FROM tanaghom.organization_agent_skill_bindings binding
    JOIN tanaghom.organization_skill_versions skill
      ON skill.id=binding.organization_skill_version_id
    JOIN tanaghom.organization_skill_definitions definition ON definition.id=skill.skill_id
   WHERE binding.agent_version_id=v_run.agent_version_id
     AND binding.organization_id=v_run.organization_id
     AND binding.skill_source='organization'
     AND binding.operating_mode<>'disabled'
     AND skill.lifecycle_state='published'
     AND definition.code=p_skill_code;
END;
$$;

CREATE FUNCTION tanaghom.record_agent_runtime_plan(
  p_run_id uuid,p_plan jsonb,p_plan_hash text,p_prompt_tokens integer,p_completion_tokens integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_policy tanaghom.organization_agent_policies%ROWTYPE;
  v_step jsonb;
  v_arguments jsonb;
  v_sequence integer := 0;
  v_plan_hash text;
BEGIN
  SELECT * INTO v_run FROM tanaghom.organization_agent_runs
   WHERE id=p_run_id AND status='planning' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'planning agent run required'; END IF;
  SELECT * INTO v_policy FROM tanaghom.organization_agent_policies
   WHERE agent_version_id=v_run.agent_version_id;
  IF p_plan_hash !~ '^sha256:[a-f0-9]{64}$'
    OR jsonb_typeof(p_plan)<>'object'
    OR NOT (p_plan ?& ARRAY[
      'contract_version','agent_version_id','agent_content_hash','language',
      'intent_summary','steps','final_response_mode'
    ])
    OR (p_plan-ARRAY[
      'contract_version','agent_version_id','agent_content_hash','language',
      'intent_summary','steps','final_response_mode'
    ])<>'{}'::jsonb
    OR p_plan->>'contract_version'<>'phase7.agent-runtime-plan.v1'
    OR p_plan->>'agent_version_id'<>v_run.agent_version_id::text
    OR p_plan->>'agent_content_hash'<>v_run.agent_content_hash
    OR jsonb_typeof(p_plan->'steps')<>'array'
    OR jsonb_array_length(p_plan->'steps') NOT BETWEEN 1 AND least(v_policy.max_steps,v_policy.max_tool_calls)
    OR p_prompt_tokens<0 OR p_completion_tokens<0
    OR p_prompt_tokens+p_completion_tokens>v_policy.max_tokens
  THEN
    RAISE EXCEPTION 'strict agent plan contract or run binding rejected';
  END IF;
  v_plan_hash := tanaghom.agent_runtime_sha256(p_plan);

  FOR v_step IN SELECT value FROM jsonb_array_elements(p_plan->'steps')
  LOOP
    v_sequence := v_sequence+1;
    IF jsonb_typeof(v_step)<>'object'
      OR NOT (v_step ?& ARRAY[
        'sequence','skill_code','operation','channel','consent_evidence',
        'arguments_json','idempotency_key','rationale'
      ])
      OR (v_step-ARRAY[
        'sequence','skill_code','operation','channel','consent_evidence',
        'arguments_json','idempotency_key','rationale'
      ])<>'{}'::jsonb
      OR (v_step->>'sequence')::integer<>v_sequence
      OR v_step->>'skill_code' !~ '^[a-z][a-z0-9_]{2,79}$'
      OR v_step->>'operation' !~ '^[a-z][a-z0-9._-]{1,79}$'
      OR v_step->>'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    THEN
      RAISE EXCEPTION 'strict agent plan step rejected';
    END IF;
    BEGIN
      v_arguments := (v_step->>'arguments_json')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'agent plan arguments_json is invalid';
    END;
    IF NOT tanaghom.agent_runtime_json_is_safe(v_arguments,20000) THEN
      RAISE EXCEPTION 'agent plan arguments are unsafe or unbounded';
    END IF;
  END LOOP;

  UPDATE tanaghom.organization_agent_runs
     SET plan=p_plan,plan_hash=v_plan_hash,status='authorizing',
         prompt_tokens=p_prompt_tokens,completion_tokens=p_completion_tokens
   WHERE id=v_run.id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_run.organization_id,v_run.job_id,v_run.id,'plan_recorded','runtime','shared-runner',
    jsonb_build_object(
      'plan_hash',v_plan_hash,'tool_calls',jsonb_array_length(p_plan->'steps'),
      'prompt_tokens',p_prompt_tokens,'completion_tokens',p_completion_tokens
    )
  );
  RETURN jsonb_build_object(
    'run_id',v_run.id,'status','authorizing',
    'step_count',jsonb_array_length(p_plan->'steps')
  );
END;
$$;

CREATE FUNCTION tanaghom.authorize_agent_skill_invocation(
  p_run_id uuid,p_step jsonb,p_parameter_hash text
)
RETURNS TABLE(
  invocation_id uuid,authorization_status text,status text,
  denial_reason text,executor_class text,simulation_only boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_job tanaghom.organization_agent_jobs%ROWTYPE;
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_policy tanaghom.organization_agent_policies%ROWTYPE;
  v_binding tanaghom.organization_agent_skill_bindings%ROWTYPE;
  v_skill tanaghom.skill_versions%ROWTYPE;
  v_definition tanaghom.skill_definitions%ROWTYPE;
  v_existing tanaghom.organization_agent_invocations%ROWTYPE;
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_expected_step jsonb;
  v_parameters jsonb;
  v_sequence integer;
  v_operation text;
  v_channel text;
  v_consent text;
  v_idempotency text;
  v_denial text;
  v_executor_class text;
  v_requirement text;
  v_provider text;
  v_simulation boolean;
  v_approval_required boolean;
  v_authorization text;
  v_status text;
  v_parameter_hash text;
  v_local_now timestamp;
BEGIN
  SELECT runtime_run.* INTO v_run FROM tanaghom.organization_agent_runs runtime_run
   WHERE runtime_run.id=p_run_id
     AND runtime_run.status IN ('authorizing','dispatching','waiting_approval')
   FOR UPDATE;
  IF NOT FOUND OR v_run.plan IS NULL THEN
    RAISE EXCEPTION 'planned tenant-bound agent run required';
  END IF;
  SELECT runtime_job.* INTO v_job FROM tanaghom.organization_agent_jobs runtime_job
   WHERE runtime_job.id=v_run.job_id
     AND runtime_job.organization_id=v_run.organization_id FOR UPDATE;
  SELECT agent_version.* INTO v_version
    FROM tanaghom.organization_agent_versions agent_version
   WHERE agent_version.id=v_run.agent_version_id
     AND agent_version.organization_id=v_run.organization_id;
  SELECT agent_policy.* INTO v_policy
    FROM tanaghom.organization_agent_policies agent_policy
   WHERE agent_policy.agent_version_id=v_run.agent_version_id;

  IF jsonb_typeof(p_step)<>'object'
    OR p_parameter_hash !~ '^sha256:[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'strict invocation request required';
  END IF;
  v_sequence := (p_step->>'sequence')::integer;
  SELECT value INTO v_expected_step
    FROM jsonb_array_elements(v_run.plan->'steps') value
   WHERE (value->>'sequence')::integer=v_sequence;
  IF NOT FOUND OR v_expected_step IS DISTINCT FROM p_step THEN
    RAISE EXCEPTION 'invocation is not bound to the recorded plan';
  END IF;
  BEGIN
    v_parameters := (p_step->>'arguments_json')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invocation arguments_json is invalid';
  END;
  IF NOT tanaghom.agent_runtime_json_is_safe(v_parameters,20000) THEN
    RAISE EXCEPTION 'invocation parameters are unsafe or unbounded';
  END IF;
  v_parameter_hash := tanaghom.agent_runtime_sha256(v_parameters);

  v_operation := p_step->>'operation';
  v_channel := nullif(p_step->>'channel','');
  v_consent := p_step->>'consent_evidence';
  v_idempotency := p_step->>'idempotency_key';

  SELECT * INTO v_existing FROM tanaghom.organization_agent_invocations
   WHERE organization_id=v_run.organization_id AND idempotency_key=v_idempotency;
  IF FOUND THEN
    IF v_existing.parameter_hash IS DISTINCT FROM v_parameter_hash
      OR v_existing.requested_skill_code IS DISTINCT FROM p_step->>'skill_code'
      OR v_existing.operation IS DISTINCT FROM v_operation
      OR v_existing.parameters IS DISTINCT FROM v_parameters
    THEN
      RAISE EXCEPTION 'agent invocation idempotency conflict';
    END IF;
    RETURN QUERY SELECT
      v_existing.id,v_existing.authorization_status,v_existing.status,
      v_existing.denial_reason,v_existing.executor_class,v_existing.simulation_only;
    RETURN;
  END IF;

  SELECT binding.* INTO v_binding
    FROM tanaghom.organization_agent_skill_bindings binding
    JOIN tanaghom.skill_versions skill ON skill.id=binding.platform_skill_version_id
    JOIN tanaghom.skill_definitions definition ON definition.id=skill.skill_id
   WHERE binding.organization_id=v_run.organization_id
     AND binding.agent_version_id=v_run.agent_version_id
     AND binding.skill_source='platform'
     AND definition.code=p_step->>'skill_code';
  IF NOT FOUND THEN
    v_denial := 'skill_not_assigned_or_not_executable';
  ELSE
    SELECT * INTO v_skill FROM tanaghom.skill_versions WHERE id=v_binding.platform_skill_version_id;
    SELECT * INTO v_definition FROM tanaghom.skill_definitions WHERE id=v_skill.skill_id;
  END IF;

  IF v_denial IS NULL AND (
    v_version.lifecycle_state NOT IN ('validated','simulation','shadow','assisted','active')
    OR v_binding.operating_mode='disabled'
    OR v_skill.lifecycle_state<>'published'
  ) THEN
    v_denial := 'agent_or_skill_disabled';
  END IF;
  IF v_denial IS NULL
    AND NOT (v_skill.permission_manifest->'operations' ? v_operation)
  THEN
    v_denial := 'operation_not_permitted';
  END IF;
  IF v_denial IS NULL
    AND v_parameters ? 'record_type'
    AND NOT ((v_parameters->>'record_type')=ANY(v_policy.allowed_record_types))
  THEN
    v_denial := 'record_type_not_permitted';
  END IF;
  IF v_denial IS NULL
    AND cardinality(v_policy.allowed_action_types)>0
    AND NOT (
      v_operation=ANY(v_policy.allowed_action_types)
      OR ('proposal.create'=ANY(v_policy.allowed_action_types)
          AND v_skill.side_effect_class='proposal_only')
      OR ('read.execute'=ANY(v_policy.allowed_action_types)
          AND v_skill.side_effect_class='read_only')
    )
  THEN
    v_denial := 'action_type_not_permitted';
  END IF;
  IF v_denial IS NULL
    AND jsonb_array_length(v_skill.permission_manifest->'channels')>0
    AND (
      v_channel IS NULL
      OR NOT (v_skill.permission_manifest->'channels' ? v_channel)
      OR NOT v_channel=ANY(v_policy.allowed_channels)
    )
  THEN
    v_denial := 'channel_not_permitted';
  END IF;
  IF v_denial IS NULL
    AND v_policy.consent_required
    AND (v_operation LIKE 'ghl.%' OR v_operation LIKE 'conversation.%')
    AND (v_consent<>'verified' OR NOT v_job.consent_verified)
  THEN
    v_denial := 'consent_missing';
  END IF;
  IF v_denial IS NULL AND v_run.tool_call_count>=v_policy.max_tool_calls THEN
    v_denial := 'tool_call_limit_exceeded';
  END IF;
  IF v_denial IS NULL AND EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_dependency_blocks block
     WHERE block.organization_id=v_run.organization_id AND block.status='active'
  ) THEN
    v_denial := 'indeterminate_operation_requires_reconciliation';
  END IF;
  IF v_denial IS NULL AND EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop
  ) THEN
    v_denial := 'runtime_emergency_stop';
  END IF;

  IF v_skill.id IS NOT NULL THEN
    v_requirement := v_skill.integration_requirements[1];
  END IF;
  IF v_denial IS NULL
    AND v_requirement IN ('postiz_private_gateway','ghl_private_gateway')
  THEN
    v_provider := CASE v_requirement
      WHEN 'postiz_private_gateway' THEN 'postiz'
      WHEN 'ghl_private_gateway' THEN 'ghl'
    END;
    IF NOT EXISTS (
      SELECT 1
        FROM tanaghom.organization_agent_integration_bindings integration
        JOIN tanaghom.integration_connections connection
          ON connection.id=integration.connection_id
         AND connection.organization_id=integration.organization_id
       WHERE integration.organization_id=v_run.organization_id
         AND integration.agent_version_id=v_run.agent_version_id
         AND integration.provider=v_provider
         AND (v_channel IS NULL OR v_channel=ANY(integration.channels))
         AND connection.status='connected'
         AND connection.last_test_status='passed'
    ) THEN
      v_denial := 'integration_not_ready';
    END IF;
  END IF;
  IF v_denial IS NULL AND v_provider='postiz' AND EXISTS (
    SELECT 1 FROM tanaghom.automation_platform_controls
     WHERE provider='postiz' AND emergency_stop
  ) THEN
    v_denial := 'postiz_emergency_stop';
  END IF;
  IF v_denial IS NULL AND v_provider='ghl' AND EXISTS (
    SELECT 1 FROM tanaghom.ghl_action_automation_status
     WHERE organization_id=v_run.organization_id
       AND (platform_emergency_stop OR action_emergency_stop OR NOT connection_ready OR NOT operations_clear)
  ) THEN
    v_denial := 'ghl_emergency_stop_or_unready';
  END IF;

  IF v_skill.side_effect_class='read_only' THEN
    v_executor_class := 'read';
  ELSIF v_skill.side_effect_class IN ('none','proposal_only') THEN
    v_executor_class := 'proposal';
  ELSIF v_skill.id IS NOT NULL THEN
    v_executor_class := 'action';
  END IF;
  v_simulation := v_job.scenario_id IS NOT NULL
    OR v_version.lifecycle_state IN ('validated','simulation','shadow');

  IF v_denial IS NULL AND v_executor_class='action' AND NOT v_simulation THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_run.organization_id::text,0));
    v_local_now := statement_timestamp() AT TIME ZONE v_policy.business_timezone;
    IF v_version.lifecycle_state NOT IN ('assisted','active') THEN
      v_denial := 'action_rollout_state_not_permitted';
    ELSIF jsonb_array_length(v_policy.business_hours)>0
      AND NOT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_policy.business_hours) business_window
         WHERE (business_window->>'day')::integer=extract(dow FROM v_local_now)::integer
           AND v_local_now::time>=(business_window->>'start')::time
           AND v_local_now::time<(business_window->>'end')::time
      )
    THEN
      v_denial := 'outside_business_hours';
    ELSIF v_parameters ? 'follow_up_number'
      AND (
        v_parameters->>'follow_up_number' !~ '^[0-9]{1,2}$'
        OR (v_parameters->>'follow_up_number')::integer>v_policy.max_follow_ups_per_contact
      )
    THEN
      v_denial := 'follow_up_limit_exceeded';
    ELSIF v_policy.max_daily_actions=0 THEN
      v_denial := 'daily_action_budget_is_zero';
    ELSIF (
      SELECT count(*) FROM tanaghom.organization_agent_invocations invocation
       WHERE invocation.organization_id=v_run.organization_id
         AND invocation.executor_class='action'
         AND invocation.simulation_only=false
         AND invocation.authorization_status='authorized'
         AND invocation.proposed_at>=date_trunc('day',statement_timestamp())
    ) >= v_policy.max_daily_actions THEN
      v_denial := 'daily_action_limit_exceeded';
    ELSIF (
      SELECT count(*) FROM tanaghom.organization_agent_invocations invocation
       WHERE invocation.organization_id=v_run.organization_id
         AND invocation.executor_class='action'
         AND invocation.simulation_only=false
         AND invocation.authorization_status='authorized'
         AND invocation.proposed_at>=statement_timestamp()-interval '1 minute'
    ) >= v_policy.max_actions_per_minute THEN
      v_denial := 'action_rate_limit_exceeded';
    ELSIF (
      SELECT coalesce(sum(invocation.actual_cost),0)
        FROM tanaghom.organization_agent_invocations invocation
       WHERE invocation.organization_id=v_run.organization_id
         AND invocation.proposed_at>=date_trunc('month',statement_timestamp())
    ) >= v_policy.monthly_budget THEN
      v_denial := 'monthly_budget_exhausted';
    END IF;
  END IF;

  v_approval_required := v_denial IS NULL
    AND v_executor_class='action'
    AND (
      v_binding.approval_required
      OR v_binding.operating_mode='assisted'
      OR v_operation=ANY(v_policy.approval_actions)
    );
  IF v_denial IS NOT NULL THEN
    v_authorization := 'denied';
    v_status := 'refused';
  ELSIF v_approval_required THEN
    v_authorization := 'waiting_approval';
    v_status := 'waiting_approval';
  ELSE
    v_authorization := 'authorized';
    v_status := CASE WHEN v_simulation THEN 'simulation_ready' ELSE 'ready' END;
  END IF;

  INSERT INTO tanaghom.organization_agent_invocations (
    organization_id,run_id,job_id,sequence,requested_skill_code,
    skill_binding_id,platform_skill_version_id,operation,channel,consent_evidence,
    parameters,parameter_hash,idempotency_key,authorization_status,denial_reason,
    executor_class,executor_type,executor_ref,executor_version,integration_requirement,
    simulation_only,status,authorized_at
  ) VALUES (
    v_run.organization_id,v_run.id,v_run.job_id,v_sequence,p_step->>'skill_code',
    v_binding.id,v_skill.id,v_operation,v_channel,v_consent,
    v_parameters,v_parameter_hash,v_idempotency,v_authorization,v_denial,
    v_executor_class,v_skill.executor_type,v_skill.executor_ref,v_skill.executor_version,
    v_requirement,v_simulation,v_status,
    CASE WHEN v_authorization='authorized' THEN statement_timestamp() END
  ) RETURNING * INTO v_invocation;

  UPDATE tanaghom.organization_agent_runs
     SET tool_call_count=tool_call_count+1,
         status=CASE WHEN v_status='waiting_approval' THEN 'waiting_approval' ELSE 'dispatching' END
   WHERE id=v_run.id;
  UPDATE tanaghom.organization_agent_jobs
     SET status=CASE
       WHEN v_status='waiting_approval' THEN 'waiting_approval'
       ELSE organization_agent_jobs.status
     END,
         updated_at=statement_timestamp()
   WHERE id=v_run.job_id;

  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_run.organization_id,v_run.job_id,v_run.id,v_invocation.id,
    'invocation_proposed','runtime','shared-policy-resolver',
    jsonb_build_object(
      'skill_code',p_step->>'skill_code','operation',v_operation,
      'parameter_hash',v_parameter_hash,'idempotency_key',v_idempotency,
      'authorization_status',v_authorization,'simulation_only',v_simulation
    )
  );
  IF v_denial IS NOT NULL THEN
    INSERT INTO tanaghom.organization_agent_runtime_events (
      organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
    ) VALUES (
      v_run.organization_id,v_run.job_id,v_run.id,v_invocation.id,
      'invocation_denied','runtime','shared-policy-resolver',
      jsonb_build_object('reason',v_denial)
    );
  END IF;
  RETURN QUERY SELECT
    v_invocation.id,v_invocation.authorization_status,v_invocation.status,
    v_invocation.denial_reason,v_invocation.executor_class,v_invocation.simulation_only;
END;
$$;

CREATE FUNCTION tanaghom.decide_agent_skill_invocation(
  p_organization_id uuid,p_actor_id uuid,p_invocation_id uuid,
  p_decision text,p_parameter_hash text,p_reason text
)
RETURNS TABLE(invocation_id uuid,status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_policy tanaghom.organization_agent_policies%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_invocation FROM tanaghom.organization_agent_invocations
   WHERE id=p_invocation_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_invocation.status<>'waiting_approval' THEN
    RAISE EXCEPTION 'pending tenant-bound invocation approval required';
  END IF;
  SELECT * INTO v_run FROM tanaghom.organization_agent_runs WHERE id=v_invocation.run_id;
  SELECT * INTO v_policy FROM tanaghom.organization_agent_policies
   WHERE agent_version_id=v_run.agent_version_id;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=p_actor_id AND organization_id=p_organization_id
       AND kind='human' AND role=ANY(v_policy.approval_roles)
       AND is_active=true AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'eligible active human approver required';
  END IF;
  IF p_decision NOT IN ('approved','rejected')
    OR p_parameter_hash IS DISTINCT FROM v_invocation.parameter_hash
    OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR statement_timestamp()>v_invocation.proposed_at
      +make_interval(mins=>v_policy.approval_expiry_minutes)
  THEN
    RAISE EXCEPTION 'parameter-bound invocation approval rejected or expired';
  END IF;

  INSERT INTO tanaghom.organization_agent_invocation_approvals (
    organization_id,invocation_id,parameter_hash,decision,decided_by,reason
  ) VALUES (
    p_organization_id,v_invocation.id,p_parameter_hash,p_decision,p_actor_id,p_reason
  );
  v_status := CASE
    WHEN p_decision='rejected' THEN 'refused'
    WHEN v_invocation.simulation_only THEN 'simulation_ready'
    ELSE 'ready'
  END;
  UPDATE tanaghom.organization_agent_invocations
     SET authorization_status=CASE WHEN p_decision='approved' THEN 'authorized' ELSE 'denied' END,
         denial_reason=CASE WHEN p_decision='rejected' THEN 'human_rejected' END,
         status=v_status,
         authorized_at=CASE WHEN p_decision='approved' THEN statement_timestamp() END,
         finished_at=CASE WHEN p_decision='rejected' THEN statement_timestamp() END
   WHERE id=v_invocation.id;
  UPDATE tanaghom.organization_agent_jobs SET status='running',updated_at=statement_timestamp()
   WHERE id=v_invocation.job_id AND status='waiting_approval';
  UPDATE tanaghom.organization_agent_runs SET status='dispatching'
   WHERE id=v_invocation.run_id AND status='waiting_approval';
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    p_organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'approval_recorded','human',p_actor_id::text,
    jsonb_build_object(
      'decision',p_decision,'parameter_hash',p_parameter_hash,'reason',p_reason
    )
  );
  RETURN QUERY SELECT v_invocation.id,v_status;
END;
$$;

CREATE FUNCTION tanaghom.claim_agent_skill_invocation_internal(
  p_executor_class text,p_worker_ref text
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
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_code text;
  v_instructions text;
  v_input_schema_ref text;
  v_output_schema_ref text;
  v_reference_manifest jsonb;
BEGIN
  IF p_executor_class NOT IN ('read','proposal','action')
    OR p_worker_ref !~ '^[a-z][a-z0-9._-]{2,79}$'
  THEN
    RAISE EXCEPTION 'reviewed executor class and stable worker identity required';
  END IF;
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
     AND invocation.simulation_only=false
     AND run.status='dispatching'
     AND (
       p_executor_class<>'action'
       OR version.lifecycle_state IN ('assisted','active')
     )
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
    p_worker_ref,
    jsonb_build_object(
      'executor_class',p_executor_class,
      'executor_ref',v_invocation.executor_ref,
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

CREATE FUNCTION tanaghom.claim_agent_read_invocation(p_worker_ref text)
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

CREATE FUNCTION tanaghom.claim_agent_proposal_invocation(p_worker_ref text)
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

CREATE FUNCTION tanaghom.claim_agent_action_invocation(p_worker_ref text)
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

CREATE FUNCTION tanaghom.claim_agent_simulation_invocation(p_worker_ref text)
RETURNS TABLE(
  invocation_id uuid,run_id uuid,job_id uuid,organization_id uuid,
  skill_version_id uuid,skill_code text,operation text,parameters jsonb,
  parameter_hash text,idempotency_key text,expected_behavior text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_code text;
  v_expected text;
BEGIN
  IF p_worker_ref !~ '^[a-z][a-z0-9._-]{2,79}$' THEN
    RAISE EXCEPTION 'stable simulation worker identity required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop=false
  ) THEN RETURN; END IF;
  SELECT invocation.* INTO v_invocation
    FROM tanaghom.organization_agent_invocations invocation
    JOIN tanaghom.organization_agent_runs run ON run.id=invocation.run_id
    JOIN tanaghom.organization_agent_jobs job ON job.id=run.job_id
   WHERE invocation.status='simulation_ready'
     AND invocation.authorization_status='authorized'
     AND invocation.simulation_only=true
     AND run.status='dispatching'
     AND job.scenario_id IS NOT NULL
   ORDER BY invocation.proposed_at,invocation.id
   FOR UPDATE OF invocation SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE tanaghom.organization_agent_invocations
     SET status='in_progress',started_at=statement_timestamp()
   WHERE id=v_invocation.id RETURNING * INTO v_invocation;
  SELECT definition.code INTO v_code
    FROM tanaghom.skill_versions skill
    JOIN tanaghom.skill_definitions definition ON definition.id=skill.skill_id
   WHERE skill.id=v_invocation.platform_skill_version_id;
  SELECT scenario.expected_behavior INTO v_expected
    FROM tanaghom.organization_agent_jobs job
    JOIN tanaghom.organization_agent_test_scenarios scenario ON scenario.id=job.scenario_id
   WHERE job.id=v_invocation.job_id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_invocation.organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'invocation_claimed','runtime',p_worker_ref,
    jsonb_build_object('executor_class','simulation','external_action_allowed',false)
  );
  RETURN QUERY SELECT
    v_invocation.id,v_invocation.run_id,v_invocation.job_id,v_invocation.organization_id,
    v_invocation.platform_skill_version_id,v_code,v_invocation.operation,
    v_invocation.parameters,v_invocation.parameter_hash,v_invocation.idempotency_key,v_expected;
END;
$$;

CREATE FUNCTION tanaghom.agent_runtime_result_is_valid(
  p_invocation_id uuid,p_outcome text,p_result jsonb,
  p_prompt_tokens integer,p_completion_tokens integer,p_actual_cost numeric,
  p_provider_reference text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_output jsonb;
BEGIN
  IF jsonb_typeof(p_result)<>'object'
    OR NOT (p_result ?& ARRAY[
      'contract_version','invocation_id','outcome','output_json',
      'provider_reference','prompt_tokens','completion_tokens',
      'actual_cost','error_code'
    ])
    OR (p_result-ARRAY[
      'contract_version','invocation_id','outcome','output_json',
      'provider_reference','prompt_tokens','completion_tokens',
      'actual_cost','error_code'
    ])<>'{}'::jsonb
    OR p_result->>'contract_version'<>'phase7.agent-runtime-result.v1'
    OR p_result->>'invocation_id'<>p_invocation_id::text
    OR p_result->>'outcome'<>p_outcome
    OR jsonb_typeof(p_result->'output_json')<>'string'
    OR (p_result->>'prompt_tokens')::integer<>p_prompt_tokens
    OR (p_result->>'completion_tokens')::integer<>p_completion_tokens
    OR (p_result->>'actual_cost')::numeric<>p_actual_cost
    OR (
      p_provider_reference IS NULL
      AND p_result->'provider_reference'<>'null'::jsonb
    )
    OR (
      p_provider_reference IS NOT NULL
      AND p_result->>'provider_reference' IS DISTINCT FROM p_provider_reference
    )
    OR (
      p_result->'error_code'<>'null'::jsonb
      AND p_result->>'error_code' !~ '^[a-z][a-z0-9._-]{1,79}$'
    )
    OR (
      p_outcome='succeeded' AND p_result->'error_code'<>'null'::jsonb
    )
    OR (
      p_outcome IN ('failed','indeterminate')
      AND p_result->'error_code'='null'::jsonb
    )
  THEN
    RETURN false;
  END IF;
  v_output := (p_result->>'output_json')::jsonb;
  RETURN tanaghom.agent_runtime_json_is_safe(v_output,30000);
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

CREATE FUNCTION tanaghom.complete_agent_skill_invocation_internal(
  p_invocation_id uuid,p_executor_class text,p_outcome text,p_result jsonb,
  p_prompt_tokens integer,p_completion_tokens integer,p_actual_cost numeric,
  p_provider_reference text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
  v_status text;
  v_actor_kind text;
BEGIN
  SELECT * INTO v_invocation FROM tanaghom.organization_agent_invocations
   WHERE id=p_invocation_id AND executor_class=p_executor_class
     AND simulation_only=false AND status='in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claimed executor-specific invocation required'; END IF;
  IF p_outcome NOT IN ('succeeded','refused','failed','indeterminate')
    OR NOT tanaghom.agent_runtime_result_is_valid(
      p_invocation_id,p_outcome,p_result,p_prompt_tokens,p_completion_tokens,
      p_actual_cost,p_provider_reference
    )
    OR p_prompt_tokens<0 OR p_completion_tokens<0
    OR p_actual_cost<0 OR p_actual_cost>1000000
  THEN
    RAISE EXCEPTION 'bounded executor result required';
  END IF;
  v_status := p_outcome;
  v_actor_kind := CASE p_executor_class
    WHEN 'read' THEN 'read_executor'
    WHEN 'proposal' THEN 'proposal_executor'
    ELSE 'action_executor'
  END;
  UPDATE tanaghom.organization_agent_invocations
     SET status=v_status,result_summary=p_result,provider_reference=p_provider_reference,
         prompt_tokens=p_prompt_tokens,completion_tokens=p_completion_tokens,
         actual_cost=p_actual_cost,finished_at=statement_timestamp()
   WHERE id=v_invocation.id;
  UPDATE tanaghom.organization_agent_runs
     SET prompt_tokens=prompt_tokens+p_prompt_tokens,
         completion_tokens=completion_tokens+p_completion_tokens,
         actual_cost=actual_cost+p_actual_cost
   WHERE id=v_invocation.run_id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_invocation.organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'invocation_completed',v_actor_kind,coalesce(v_invocation.executor_ref,p_executor_class),
    jsonb_build_object(
      'outcome',p_outcome,'provider_reference',p_provider_reference,
      'prompt_tokens',p_prompt_tokens,'completion_tokens',p_completion_tokens,
      'actual_cost',p_actual_cost
    )
  );
  IF p_outcome='indeterminate'
    AND p_executor_class='action'
    AND v_invocation.integration_requirement IN ('postiz_private_gateway','ghl_private_gateway')
  THEN
    INSERT INTO tanaghom.organization_agent_dependency_blocks (
      organization_id,invocation_id,integration_requirement,reason
    ) VALUES (
      v_invocation.organization_id,v_invocation.id,v_invocation.integration_requirement,
      'Provider outcome is indeterminate; automated claims remain blocked until human reconciliation.'
    );
    INSERT INTO tanaghom.organization_agent_runtime_events (
      organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
    ) VALUES (
      v_invocation.organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
      'dependency_blocked','action_executor',coalesce(v_invocation.executor_ref,'action-executor'),
      jsonb_build_object('integration_requirement',v_invocation.integration_requirement)
    );
  END IF;
  RETURN v_status;
END;
$$;

CREATE FUNCTION tanaghom.complete_agent_read_invocation(
  p_invocation_id uuid,p_outcome text,p_result jsonb,
  p_prompt_tokens integer,p_completion_tokens integer,p_actual_cost numeric,
  p_provider_reference text
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT tanaghom.complete_agent_skill_invocation_internal(
    p_invocation_id,'read',p_outcome,p_result,p_prompt_tokens,p_completion_tokens,
    p_actual_cost,p_provider_reference
  );
$$;

CREATE FUNCTION tanaghom.complete_agent_proposal_invocation(
  p_invocation_id uuid,p_outcome text,p_result jsonb,
  p_prompt_tokens integer,p_completion_tokens integer,p_actual_cost numeric,
  p_provider_reference text
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT tanaghom.complete_agent_skill_invocation_internal(
    p_invocation_id,'proposal',p_outcome,p_result,p_prompt_tokens,p_completion_tokens,
    p_actual_cost,p_provider_reference
  );
$$;

CREATE FUNCTION tanaghom.complete_agent_action_invocation(
  p_invocation_id uuid,p_outcome text,p_result jsonb,
  p_prompt_tokens integer,p_completion_tokens integer,p_actual_cost numeric,
  p_provider_reference text
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT tanaghom.complete_agent_skill_invocation_internal(
    p_invocation_id,'action',p_outcome,p_result,p_prompt_tokens,p_completion_tokens,
    p_actual_cost,p_provider_reference
  );
$$;

CREATE FUNCTION tanaghom.complete_agent_simulation_invocation(
  p_invocation_id uuid,p_outcome text,p_result jsonb,
  p_prompt_tokens integer,p_completion_tokens integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
BEGIN
  SELECT * INTO v_invocation FROM tanaghom.organization_agent_invocations
   WHERE id=p_invocation_id AND simulation_only=true AND status='in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claimed simulation invocation required'; END IF;
  IF p_outcome NOT IN ('succeeded','refused','failed')
    OR NOT tanaghom.agent_runtime_result_is_valid(
      p_invocation_id,p_outcome,p_result,p_prompt_tokens,p_completion_tokens,0,NULL
    )
    OR (p_result->>'output_json')::jsonb->>'external_action_count'<>'0'
    OR p_prompt_tokens<0 OR p_completion_tokens<0
  THEN
    RAISE EXCEPTION 'bounded simulation result required';
  END IF;
  UPDATE tanaghom.organization_agent_invocations
     SET status=p_outcome,result_summary=p_result,
         prompt_tokens=p_prompt_tokens,completion_tokens=p_completion_tokens,
         actual_cost=0,finished_at=statement_timestamp()
   WHERE id=v_invocation.id;
  UPDATE tanaghom.organization_agent_runs
     SET prompt_tokens=prompt_tokens+p_prompt_tokens,
         completion_tokens=completion_tokens+p_completion_tokens
   WHERE id=v_invocation.run_id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_invocation.organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'invocation_completed','runtime','simulation-dispatcher',
    jsonb_build_object(
      'outcome',p_outcome,'external_action_count',0,
      'prompt_tokens',p_prompt_tokens,'completion_tokens',p_completion_tokens
    )
  );
  RETURN p_outcome;
END;
$$;

CREATE FUNCTION tanaghom.finalize_agent_runtime_run(
  p_run_id uuid,p_outcome text,p_summary jsonb,p_scenario_result text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_job tanaghom.organization_agent_jobs%ROWTYPE;
  v_step_count integer;
  v_invocation_count integer;
  v_status text;
BEGIN
  SELECT * INTO v_run FROM tanaghom.organization_agent_runs
   WHERE id=p_run_id AND status IN ('authorizing','dispatching','waiting_approval')
   FOR UPDATE;
  IF NOT FOUND OR v_run.plan IS NULL THEN
    RAISE EXCEPTION 'active planned agent run required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.organization_agent_jobs
   WHERE id=v_run.job_id AND organization_id=v_run.organization_id FOR UPDATE;
  IF p_outcome NOT IN ('succeeded','refused','failed','cancelled','indeterminate')
    OR NOT tanaghom.agent_runtime_json_is_safe(p_summary,30000)
    OR (v_job.scenario_id IS NULL AND p_scenario_result IS NOT NULL)
    OR (v_job.scenario_id IS NOT NULL AND p_scenario_result NOT IN ('passed','failed'))
  THEN
    RAISE EXCEPTION 'bounded final agent outcome required';
  END IF;
  v_step_count := jsonb_array_length(v_run.plan->'steps');
  SELECT count(*) INTO v_invocation_count
    FROM tanaghom.organization_agent_invocations WHERE run_id=v_run.id;
  IF v_invocation_count<>v_step_count OR EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE run_id=v_run.id
       AND status IN ('waiting_approval','simulation_ready','ready','in_progress')
  ) THEN
    RAISE EXCEPTION 'every planned invocation must reach a terminal state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE run_id=v_run.id AND status='indeterminate'
  ) THEN
    v_status := 'indeterminate';
  ELSIF EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE run_id=v_run.id AND status='failed'
  ) AND p_outcome='succeeded' THEN
    v_status := 'failed';
  ELSIF v_job.scenario_id IS NULL AND EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE run_id=v_run.id AND status='refused'
  ) AND p_outcome='succeeded' THEN
    v_status := 'refused';
  ELSE
    v_status := p_outcome;
  END IF;

  UPDATE tanaghom.organization_agent_runs
     SET status=v_status,finished_at=statement_timestamp()
   WHERE id=v_run.id;
  UPDATE tanaghom.organization_agent_jobs
     SET status=v_status,scenario_result=p_scenario_result,
         finished_at=statement_timestamp(),lease_token=NULL,
         lease_expires_at=NULL,updated_at=statement_timestamp()
   WHERE id=v_job.id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_run.organization_id,v_run.job_id,v_run.id,'run_completed','runtime','shared-runner',
    jsonb_build_object(
      'outcome',v_status,'scenario_result',p_scenario_result,
      'summary',p_summary,'tool_call_count',v_run.tool_call_count
    )
  );
  RETURN v_status;
END;
$$;

CREATE FUNCTION tanaghom.fail_agent_runtime_run(
  p_run_id uuid,p_error_code text,p_error_message text,p_retryable boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_run tanaghom.organization_agent_runs%ROWTYPE;
  v_job tanaghom.organization_agent_jobs%ROWTYPE;
  v_policy tanaghom.organization_agent_policies%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_run FROM tanaghom.organization_agent_runs
   WHERE id=p_run_id AND status NOT IN ('succeeded','refused','failed','cancelled','indeterminate')
   FOR UPDATE;
  IF NOT FOUND
    OR p_error_code !~ '^[a-z][a-z0-9._-]{1,79}$'
    OR length(trim(coalesce(p_error_message,''))) NOT BETWEEN 3 AND 1000
  THEN
    RAISE EXCEPTION 'active run and bounded failure evidence required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.organization_agent_jobs
   WHERE id=v_run.job_id FOR UPDATE;
  SELECT * INTO v_policy FROM tanaghom.organization_agent_policies
   WHERE agent_version_id=v_run.agent_version_id;
  v_status := CASE
    WHEN coalesce(p_retryable,false) AND v_job.attempt<=v_policy.max_retries
      THEN 'queued'
    ELSE 'failed'
  END;
  UPDATE tanaghom.organization_agent_runs
     SET status='failed',finished_at=statement_timestamp()
   WHERE id=v_run.id;
  UPDATE tanaghom.organization_agent_jobs
     SET status=v_status,error_code=p_error_code,error_message=p_error_message,
         available_at=CASE WHEN v_status='queued'
           THEN statement_timestamp()+make_interval(secs=>least(300,5*(2^v_job.attempt)::integer))
           ELSE available_at END,
         finished_at=CASE WHEN v_status='failed' THEN statement_timestamp() END,
         lease_token=NULL,lease_expires_at=NULL,updated_at=statement_timestamp()
   WHERE id=v_job.id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    v_run.organization_id,v_run.job_id,v_run.id,'run_failed','runtime','shared-runner',
    jsonb_build_object(
      'error_code',p_error_code,'retryable',coalesce(p_retryable,false),
      'next_job_status',v_status,'attempt',v_job.attempt
    )
  );
  RETURN v_status;
END;
$$;

CREATE FUNCTION tanaghom.reconcile_agent_dependency_block(
  p_organization_id uuid,p_actor_id uuid,p_block_id uuid,p_resolution text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_block tanaghom.organization_agent_dependency_blocks%ROWTYPE;
  v_invocation tanaghom.organization_agent_invocations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=p_actor_id AND organization_id=p_organization_id
       AND kind='human' AND role='owner' AND is_active=true AND accepted_at IS NOT NULL
  ) OR length(trim(coalesce(p_resolution,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'active owner and bounded reconciliation evidence required';
  END IF;
  SELECT * INTO v_block FROM tanaghom.organization_agent_dependency_blocks
   WHERE id=p_block_id AND organization_id=p_organization_id AND status='active'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active tenant-bound dependency block required'; END IF;
  SELECT * INTO v_invocation FROM tanaghom.organization_agent_invocations
   WHERE id=v_block.invocation_id;
  UPDATE tanaghom.organization_agent_dependency_blocks
     SET status='reconciled',reconciled_by=p_actor_id,
         reconciled_at=statement_timestamp(),resolution=p_resolution
   WHERE id=v_block.id;
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,job_id,run_id,invocation_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    p_organization_id,v_invocation.job_id,v_invocation.run_id,v_invocation.id,
    'dependency_reconciled','human',p_actor_id::text,
    jsonb_build_object('block_id',v_block.id,'resolution',p_resolution)
  );
  RETURN 'reconciled';
END;
$$;

CREATE FUNCTION tanaghom.record_agent_runtime_certification(
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
  v_evidence_hash text;
BEGIN
  SELECT * INTO v_version FROM tanaghom.organization_agent_versions
   WHERE id=p_agent_version_id AND organization_id=p_organization_id;
  IF NOT FOUND OR v_version.lifecycle_state<>'validated'
    OR p_evidence_hash !~ '^sha256:[a-f0-9]{64}$'
    OR NOT tanaghom.agent_runtime_json_is_safe(p_evidence,30000)
    OR p_operator_ref !~ '^[a-z][a-z0-9._-]{2,79}$'
    OR NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_profiles
       WHERE id=p_runtime_profile_id AND lifecycle_state='validated'
    )
    OR EXISTS (
      SELECT 1
        FROM tanaghom.organization_agent_test_scenarios scenario
       WHERE scenario.agent_version_id=p_agent_version_id
         AND NOT EXISTS (
           SELECT 1
             FROM tanaghom.organization_agent_jobs job
            WHERE job.scenario_id=scenario.id
              AND job.agent_version_id=p_agent_version_id
              AND job.status='succeeded'
              AND job.scenario_result='passed'
         )
    )
  THEN
    RAISE EXCEPTION 'complete runtime scenario evidence is required for certification';
  END IF;
  v_evidence_hash := tanaghom.agent_runtime_sha256(p_evidence);
  INSERT INTO tanaghom.organization_agent_runtime_certifications (
    organization_id,agent_version_id,runtime_profile_id,evidence_hash,evidence,certified_by
  ) VALUES (
    p_organization_id,p_agent_version_id,p_runtime_profile_id,
    v_evidence_hash,p_evidence,p_operator_ref
  ) RETURNING id INTO v_certification;
  RETURN v_certification;
END;
$$;

CREATE FUNCTION tanaghom.promote_organization_agent_to_simulation(
  p_organization_id uuid,p_actor_id uuid,p_agent_version_id uuid,
  p_certification_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_certification tanaghom.organization_agent_runtime_certifications%ROWTYPE;
BEGIN
  PERFORM tanaghom.assert_organization_agent_owner(p_organization_id,p_actor_id);
  SELECT * INTO v_version FROM tanaghom.organization_agent_versions
   WHERE id=p_agent_version_id AND organization_id=p_organization_id FOR UPDATE;
  SELECT * INTO v_certification FROM tanaghom.organization_agent_runtime_certifications
   WHERE id=p_certification_id AND organization_id=p_organization_id
     AND agent_version_id=p_agent_version_id;
  IF v_version.id IS NULL OR v_version.lifecycle_state<>'validated'
    OR v_certification.id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_runtime_profiles
       WHERE id=v_certification.runtime_profile_id AND lifecycle_state='validated'
    )
  THEN
    RAISE EXCEPTION 'exact certified runtime evidence is required for simulation promotion';
  END IF;
  UPDATE tanaghom.organization_agent_versions
     SET lifecycle_state='simulation',
         validation_report=coalesce(validation_report,'{}'::jsonb)||jsonb_build_object(
           'runtime_certified',true,
           'runtime_profile_id',v_certification.runtime_profile_id,
           'runtime_evidence_hash',v_certification.evidence_hash
         )
   WHERE id=v_version.id;
  INSERT INTO tanaghom.organization_agent_audit_events (
    organization_id,agent_id,agent_version_id,event_type,actor_id,provenance
  ) VALUES (
    p_organization_id,v_version.agent_id,v_version.id,'simulation_started',p_actor_id,
    jsonb_build_object(
      'issue',135,'runtime_activation',false,
      'certification_id',v_certification.id,
      'runtime_profile_id',v_certification.runtime_profile_id,
      'evidence_hash',v_certification.evidence_hash
    )
  );
  INSERT INTO tanaghom.organization_agent_runtime_events (
    organization_id,event_type,actor_kind,actor_ref,evidence
  ) VALUES (
    p_organization_id,'agent_promoted','human',p_actor_id::text,
    jsonb_build_object(
      'agent_version_id',v_version.id,'lifecycle_state','simulation',
      'certification_id',v_certification.id
    )
  );
  RETURN 'simulation';
END;
$$;

REVOKE ALL ON
  tanaghom.agent_runtime_profiles,
  tanaghom.agent_runtime_controls,
  tanaghom.organization_agent_runtime_certifications,
  tanaghom.organization_agent_jobs,
  tanaghom.organization_agent_runs,
  tanaghom.organization_agent_invocations,
  tanaghom.organization_agent_invocation_approvals,
  tanaghom.organization_agent_dependency_blocks,
  tanaghom.organization_agent_runtime_events
FROM PUBLIC,tanaghom_api,tanaghom_readonly,tanaghom_n8n_worker,
  tanaghom_conversation_worker,tanaghom_agent_runtime,
  tanaghom_skill_read_executor,tanaghom_skill_proposal_executor,
  tanaghom_skill_action_executor;

GRANT SELECT ON
  tanaghom.agent_runtime_profiles,
  tanaghom.agent_runtime_controls,
  tanaghom.organization_agent_runtime_certifications,
  tanaghom.organization_agent_jobs,
  tanaghom.organization_agent_runs,
  tanaghom.organization_agent_invocations,
  tanaghom.organization_agent_invocation_approvals,
  tanaghom.organization_agent_dependency_blocks,
  tanaghom.organization_agent_runtime_events
TO tanaghom_api,tanaghom_readonly;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM
  tanaghom_agent_runtime,tanaghom_skill_read_executor,
  tanaghom_skill_proposal_executor,tanaghom_skill_action_executor;

REVOKE EXECUTE ON FUNCTION
  tanaghom.agent_runtime_json_is_safe(jsonb,integer),
  tanaghom.agent_runtime_sha256(jsonb),
  tanaghom.prevent_agent_runtime_append_only_mutation(),
  tanaghom.enforce_agent_runtime_job_integrity(),
  tanaghom.enforce_agent_runtime_invocation_integrity(),
  tanaghom.agent_runtime_result_is_valid(uuid,text,jsonb,integer,integer,numeric,text),
  tanaghom.queue_organization_agent_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,boolean,text,jsonb),
  tanaghom.queue_organization_agent_handoff(uuid,uuid,uuid,text,text,text,boolean,jsonb),
  tanaghom.claim_organization_agent_job(text),
  tanaghom.resolve_agent_skill_instructions(uuid,text),
  tanaghom.record_agent_runtime_plan(uuid,jsonb,text,integer,integer),
  tanaghom.authorize_agent_skill_invocation(uuid,jsonb,text),
  tanaghom.decide_agent_skill_invocation(uuid,uuid,uuid,text,text,text),
  tanaghom.claim_agent_skill_invocation_internal(text,text),
  tanaghom.claim_agent_read_invocation(text),
  tanaghom.claim_agent_proposal_invocation(text),
  tanaghom.claim_agent_action_invocation(text),
  tanaghom.claim_agent_simulation_invocation(text),
  tanaghom.complete_agent_skill_invocation_internal(uuid,text,text,jsonb,integer,integer,numeric,text),
  tanaghom.complete_agent_read_invocation(uuid,text,jsonb,integer,integer,numeric,text),
  tanaghom.complete_agent_proposal_invocation(uuid,text,jsonb,integer,integer,numeric,text),
  tanaghom.complete_agent_action_invocation(uuid,text,jsonb,integer,integer,numeric,text),
  tanaghom.complete_agent_simulation_invocation(uuid,text,jsonb,integer,integer),
  tanaghom.finalize_agent_runtime_run(uuid,text,jsonb,text),
  tanaghom.fail_agent_runtime_run(uuid,text,text,boolean),
  tanaghom.reconcile_agent_dependency_block(uuid,uuid,uuid,text),
  tanaghom.record_agent_runtime_certification(uuid,uuid,uuid,text,jsonb,text),
  tanaghom.promote_organization_agent_to_simulation(uuid,uuid,uuid,uuid)
FROM PUBLIC,tanaghom_api,tanaghom_readonly,tanaghom_n8n_worker,
  tanaghom_conversation_worker,tanaghom_agent_runtime,
  tanaghom_skill_read_executor,tanaghom_skill_proposal_executor,
  tanaghom_skill_action_executor;

GRANT EXECUTE ON FUNCTION
  tanaghom.queue_organization_agent_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,boolean,text,jsonb),
  tanaghom.decide_agent_skill_invocation(uuid,uuid,uuid,text,text,text),
  tanaghom.reconcile_agent_dependency_block(uuid,uuid,uuid,text),
  tanaghom.promote_organization_agent_to_simulation(uuid,uuid,uuid,uuid)
TO tanaghom_api;

GRANT EXECUTE ON FUNCTION
  tanaghom.claim_organization_agent_job(text),
  tanaghom.queue_organization_agent_handoff(uuid,uuid,uuid,text,text,text,boolean,jsonb),
  tanaghom.resolve_agent_skill_instructions(uuid,text),
  tanaghom.record_agent_runtime_plan(uuid,jsonb,text,integer,integer),
  tanaghom.authorize_agent_skill_invocation(uuid,jsonb,text),
  tanaghom.claim_agent_simulation_invocation(text),
  tanaghom.complete_agent_simulation_invocation(uuid,text,jsonb,integer,integer),
  tanaghom.finalize_agent_runtime_run(uuid,text,jsonb,text),
  tanaghom.fail_agent_runtime_run(uuid,text,text,boolean)
TO tanaghom_agent_runtime;

GRANT EXECUTE ON FUNCTION
  tanaghom.claim_agent_read_invocation(text),
  tanaghom.complete_agent_read_invocation(uuid,text,jsonb,integer,integer,numeric,text)
TO tanaghom_skill_read_executor;

GRANT EXECUTE ON FUNCTION
  tanaghom.claim_agent_proposal_invocation(text),
  tanaghom.complete_agent_proposal_invocation(uuid,text,jsonb,integer,integer,numeric,text)
TO tanaghom_skill_proposal_executor;

GRANT EXECUTE ON FUNCTION
  tanaghom.claim_agent_action_invocation(text),
  tanaghom.complete_agent_action_invocation(uuid,text,jsonb,integer,integer,numeric,text)
TO tanaghom_skill_action_executor;

INSERT INTO public.schema_migrations(version)
VALUES ('0030_policy_resolved_agent_runtime');

COMMIT;
