\set ON_ERROR_STOP on
\getenv api_password API_PASSWORD
\getenv workspace_password WORKSPACE_PASSWORD

BEGIN;
SELECT set_config('tanaghom.demo_api_password', :'api_password', false) \gset
SELECT set_config('tanaghom.demo_workspace_password', :'workspace_password', false) \gset
DO $$
DECLARE demo_password text := current_setting('tanaghom.demo_api_password');
        worker_password text := current_setting('tanaghom.demo_workspace_password');
BEGIN
  IF current_database() <> 'tanaghom_demo' THEN
    RAISE EXCEPTION 'demo database name required';
  END IF;
  IF (SELECT count(*) FROM public.schema_migrations) <> 51
     OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0054_workspace_image_quotas' THEN
    RAISE EXCEPTION 'demo database must be at exact migration 0054 ledger (51 migrations)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'tanaghom_api'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'restricted tanaghom_api role required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'tanaghom_agency_pilot_worker'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'restricted tanaghom_agency_pilot_worker role required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
     WHERE r.rolname IN ('tanaghom_api','tanaghom_agency_pilot_worker')
  ) THEN
    RAISE EXCEPTION 'demo database roles must not inherit another role';
  END IF;
  IF demo_password !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid generated demo API password';
  END IF;
  IF worker_password !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid generated workspace worker password';
  END IF;
  EXECUTE format('ALTER ROLE tanaghom_api LOGIN PASSWORD %L', demo_password);
  EXECUTE format('ALTER ROLE tanaghom_agency_pilot_worker LOGIN PASSWORD %L', worker_password);
  PERFORM set_config('tanaghom.demo_api_password', '', false);
  PERFORM set_config('tanaghom.demo_workspace_password', '', false);
END $$;
REVOKE ALL ON DATABASE tanaghom_demo FROM tanaghom_agency_pilot_worker;
GRANT CONNECT ON DATABASE tanaghom_demo TO tanaghom_agency_pilot_worker;
ALTER ROLE tanaghom_agency_pilot_worker SET statement_timeout = '10s';
ALTER ROLE tanaghom_agency_pilot_worker SET idle_in_transaction_session_timeout = '10s';

-- Workspace completion and retry are owned by migration 0053. Do not recreate
-- them here: fresh installs must receive the immutable-task step-retry contract
-- rather than in-place task resets.
--
-- The claim function is repeated only to widen its lease window. A bounded
-- four-attempt Gemini retry can run for ~200 seconds, so the migration's
-- 180-second lease could expire while the worker was still retrying. Keep the
-- rest of the 0053 claim definition byte-for-byte equivalent.
CREATE OR REPLACE FUNCTION tanaghom.claim_agency_workspace_task_for_models(p_models uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE; w tanaghom.agency_workspaces%ROWTYPE; step tanaghom.agency_workspace_steps%ROWTYPE; expired record; memory jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-claim',0));
 IF p_models IS NULL OR cardinality(p_models)=0 OR array_position(p_models,NULL) IS NOT NULL
 OR NOT (p_models <@ ARRAY['7d000000-0000-4000-8000-000000000002'::uuid,'7d000000-0000-4000-8000-000000000003'::uuid])
 THEN RAISE EXCEPTION 'workspace worker model configuration invalid'; END IF;
 FOR expired IN SELECT a.id,s.workspace_id FROM tanaghom.agency_pilot_tasks a JOIN tanaghom.agency_workspace_steps s ON s.task_id=a.id
  WHERE a.status='in_progress' AND a.lease_expires_at<now() LOOP
  UPDATE tanaghom.agency_pilot_tasks SET status='failed',error_code='inference_outcome_unknown',finished_at=now(),response_hash=tanaghom.agent_runtime_sha256('"lease_expired"'::jsonb) WHERE id=expired.id;
  INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
   SELECT organization_id,id,'failed',id,'{"reason":"inference_outcome_unknown"}' FROM tanaghom.agency_pilot_tasks WHERE id=expired.id;
  INSERT INTO tanaghom.agency_workspace_events(organization_id,workspace_id,event_type,actor_kind,actor_ref,evidence)
   SELECT organization_id,id,'failed','worker','lease-recovery','{"reason":"inference_outcome_unknown"}' FROM tanaghom.agency_workspaces WHERE id=expired.workspace_id;
  UPDATE tanaghom.agency_workspaces SET status='failed',error_code='inference_outcome_unknown' WHERE id=expired.workspace_id AND status NOT IN ('cancelled','approved','rejected');
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_control WHERE enabled AND NOT emergency_stop)
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM tanaghom.agency_pilot_tasks a JOIN tanaghom.agency_workspace_steps s ON s.task_id=a.id WHERE a.status='in_progress') THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM tanaghom.agency_workspace_events WHERE event_type='claimed' AND occurred_at>now()-interval '24 hours')>=100
 THEN RETURN NULL; END IF;
 SELECT a.* INTO t FROM tanaghom.agency_pilot_tasks a JOIN tanaghom.agency_workspace_steps s ON s.task_id=a.id
 JOIN tanaghom.agency_workspaces x ON x.id=s.workspace_id
 JOIN tanaghom.agency_pilot_bindings b ON b.id=a.binding_id
 JOIN tanaghom.organization_agent_versions v ON v.id=b.agent_version_id
 JOIN tanaghom.organization_agent_policies p ON p.agent_version_id=v.id
 JOIN tanaghom.app_users u ON u.id=x.requested_by
 WHERE a.status='queued' AND a.attempt=0 AND x.status IN ('queued','running')
 AND a.model_profile_id=ANY(p_models)
 AND (x.started_at>now()-interval '24 hours'
   OR EXISTS(SELECT 1 FROM tanaghom.agency_workspace_events e
     WHERE e.workspace_id=x.id AND e.event_type='resumed' AND e.occurred_at>now()-interval '24 hours'))
 AND v.lifecycle_state IN ('validated','simulation')
 AND p.max_daily_actions=0 AND p.max_retries=0 AND p.monthly_budget=0
 AND u.kind='human' AND u.role='owner' AND u.is_active AND u.accepted_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_steps prev JOIN tanaghom.agency_pilot_tasks pt ON pt.id=prev.task_id
  WHERE prev.workspace_id=x.id AND prev.sequence<s.sequence AND pt.status<>'succeeded')
 ORDER BY x.created_at,s.sequence LIMIT 1 FOR UPDATE OF a SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO step FROM tanaghom.agency_workspace_steps WHERE task_id=t.id;
 SELECT * INTO w FROM tanaghom.agency_workspaces WHERE id=step.workspace_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('task_id',a.id,'profile',s.profile_code,'response_hash',a.response_hash,'document',a.result->>'document') ORDER BY s.sequence),'[]') INTO memory
  FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_pilot_tasks a ON a.id=s.task_id WHERE s.workspace_id=w.id AND s.sequence<step.sequence AND a.status='succeeded';
 UPDATE tanaghom.agency_pilot_tasks SET status='in_progress',attempt=1,lease_token=gen_random_uuid(),claimed_at=now(),lease_expires_at=now()+interval '300 seconds',
  basis_hash=tanaghom.agent_runtime_sha256(jsonb_build_array(w.input_hash,memory)),prepared=jsonb_build_object('shared_context',memory)
 WHERE id=t.id RETURNING * INTO t;
 UPDATE tanaghom.agency_workspaces SET status='running' WHERE id=w.id;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence) VALUES(w.organization_id,t.id,'claimed',t.id,jsonb_build_object('workspace_id',w.id));
 INSERT INTO tanaghom.agency_workspace_events(organization_id,workspace_id,event_type,actor_kind,actor_ref,evidence)
 VALUES(w.organization_id,w.id,'claimed','worker',step.profile_code,jsonb_build_object('task_id',t.id,'sequence',step.sequence,'context_hash',t.basis_hash,'source_tasks',(SELECT coalesce(jsonb_agg(x->>'task_id'),'[]') FROM jsonb_array_elements(memory) x)));
 RETURN jsonb_build_object('task_id',t.id,'lease_token',t.lease_token,'workspace_id',w.id,'profile',step.profile_code,
  'language',w.language,'title',w.title,'brief',w.brief,'source_facts',w.source_facts,'shared_context',memory,'context_hash',t.basis_hash,
  'model',(SELECT model_name FROM tanaghom.agent_runtime_profiles WHERE id=t.model_profile_id));
END $$;

-- Keep the runtime profile aligned with the reviewed config pin. This is data
-- configuration, not a new migration; the deployed migration ledger stays at
-- 0053. The profile hash is the sha256 of JSON.stringify(config manifest).
ALTER TABLE tanaghom.agent_runtime_profiles DROP CONSTRAINT IF EXISTS agent_runtime_profiles_workspace_contract_check;
-- Profiles are immutable at runtime; this reviewed deploy-time pin update is
-- the same controlled operation used by 0048 down/up. The transaction restores
-- the trigger if any statement below fails.
ALTER TABLE tanaghom.agent_runtime_profiles DISABLE TRIGGER agent_runtime_profile_immutable;
UPDATE tanaghom.agent_runtime_profiles
   SET code='gemini_3_5_flash_lite_workspace_v1',
       model_name='gemini-3.5-flash-lite',
       planner_schema_hash='c9b8911d4385287a84d742f685ba82661cd83352e33d5d02813ec751ea0c749e'
 WHERE id='7d000000-0000-4000-8000-000000000003'
   AND planner_contract_version='agency.workspace.document.v1';
ALTER TABLE tanaghom.agent_runtime_profiles ENABLE TRIGGER agent_runtime_profile_immutable;
ALTER TABLE tanaghom.agent_runtime_profiles ADD CONSTRAINT agent_runtime_profiles_workspace_contract_check CHECK (
  (
    planner_contract_version='phase7.agent-runtime-plan.v1'
    AND planner_schema_ref='packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json'
    AND prompt_version='policy-resolved-agent.v1'
    AND parser_version='tanaghom.strict-json.v1'
  )
  OR (
    planner_contract_version='agency.workspace.document.v1'
    AND planner_schema_ref='config/agency-workspace.v1.json'
    AND planner_schema_hash='c9b8911d4385287a84d742f685ba82661cd83352e33d5d02813ec751ea0c749e'
    AND prompt_version='agency-workspace-specialists.v1'
    AND prompt_hash='42725947ade76804d170581d934cc8bce49d5a5ffeb40ff9b2b4a3e732253c51'
    AND parser_version='google.gemini.generate-content.v1'
  )
);

CREATE OR REPLACE FUNCTION tanaghom.set_agency_workspace_circuit_breaker(p_enabled boolean,p_emergency_stop boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=tanaghom,pg_temp AS $$
DECLARE state tanaghom.agency_workspace_control%ROWTYPE;
BEGIN
 IF p_enabled IS NULL OR p_emergency_stop IS NULL THEN RAISE EXCEPTION 'circuit breaker state required'; END IF;
 IF length(coalesce(p_reason,''))>500 THEN RAISE EXCEPTION 'circuit breaker reason too long'; END IF;
 UPDATE tanaghom.agency_workspace_control
    SET enabled=p_enabled,
        emergency_stop=p_emergency_stop,
        reason=CASE
          WHEN coalesce(nullif(trim(p_reason),''),'') LIKE 'OPERATOR_STOP:%' THEN trim(p_reason)
          WHEN p_emergency_stop THEN 'OPERATOR_STOP:' || coalesce(nullif(trim(p_reason),''),'Manual operator stop')
          ELSE 'Operational'
        END,
        updated_at=now()
  RETURNING * INTO state;
 RETURN jsonb_build_object('enabled',state.enabled,'emergency_stop',state.emergency_stop,'reason',state.reason);
END $$;

ALTER TABLE tanaghom.agency_workspace_control ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE tanaghom.agency_workspace_control ALTER COLUMN emergency_stop SET DEFAULT false;
ALTER TABLE tanaghom.agency_workspace_control ALTER COLUMN reason SET DEFAULT 'Operational';
UPDATE tanaghom.agency_workspace_control
   SET enabled=true,emergency_stop=false,reason='Operational',updated_at=now()
 WHERE reason NOT LIKE 'OPERATOR_STOP:%';

REVOKE ALL ON FUNCTION tanaghom.set_agency_workspace_circuit_breaker(boolean,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.set_agency_workspace_circuit_breaker(boolean,boolean,text) TO tanaghom_api;

-- Migration 0054 owns the AI image tables; the API role reads and writes its
-- own tenant rows and nothing else.
GRANT SELECT, INSERT, UPDATE ON tanaghom.workspace_post_images TO tanaghom_api;
GRANT SELECT, INSERT, UPDATE ON tanaghom.workspace_monthly_image_usage TO tanaghom_api;
COMMIT;
