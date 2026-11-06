BEGIN;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.schema_migrations) <> 44
 OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0047_smartlabs_audio'
 THEN RAISE EXCEPTION '0048 requires exact 0047 baseline'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM tanaghom.agent_runtime_profiles
  WHERE id='7d000000-0000-4000-8000-000000000002'
    AND code='gemma4_26b_a4b_canary_strict_v1'
    AND model_name='gemma4-26b-a4b-canary'
    AND lifecycle_state='validated'
 ) THEN RAISE EXCEPTION 'reviewed Gemma profile is missing or changed'; END IF;
END $$;

ALTER TABLE tanaghom.agent_runtime_profiles
  DROP CONSTRAINT agent_runtime_profiles_planner_contract_version_check,
  DROP CONSTRAINT agent_runtime_profiles_planner_schema_ref_check,
  DROP CONSTRAINT agent_runtime_profiles_prompt_version_check,
  DROP CONSTRAINT agent_runtime_profiles_parser_version_check,
  ADD CONSTRAINT agent_runtime_profiles_workspace_contract_check CHECK (
    (
      planner_contract_version='phase7.agent-runtime-plan.v1'
      AND planner_schema_ref='packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json'
      AND prompt_version='policy-resolved-agent.v1'
      AND parser_version='tanaghom.strict-json.v1'
    )
    OR (
      planner_contract_version='agency.workspace.document.v1'
      AND planner_schema_ref='config/agency-workspace.v1.json'
      AND planner_schema_hash='4f9e1a1634dc97c74b5f79bad9eafe836c1c9050ab110db1dc832c6a48dcc260'
      AND prompt_version='agency-workspace-specialists.v1'
      AND prompt_hash='42725947ade76804d170581d934cc8bce49d5a5ffeb40ff9b2b4a3e732253c51'
      AND parser_version='google.gemini.generate-content.v1'
    )
  );

INSERT INTO tanaghom.agent_runtime_profiles (
  id,code,model_name,planner_contract_version,planner_schema_ref,planner_schema_hash,
  prompt_version,prompt_hash,parser_version,lifecycle_state
) VALUES (
  '7d000000-0000-4000-8000-000000000003',
  'gemini_3_8_flash_workspace_v1',
  'gemini-3.8-flash',
  'agency.workspace.document.v1',
  'config/agency-workspace.v1.json',
  '4f9e1a1634dc97c74b5f79bad9eafe836c1c9050ab110db1dc832c6a48dcc260',
  'agency-workspace-specialists.v1',
  '42725947ade76804d170581d934cc8bce49d5a5ffeb40ff9b2b4a3e732253c51',
  'google.gemini.generate-content.v1',
  'validated'
);

CREATE OR REPLACE FUNCTION tanaghom.start_agency_workspace(p_actor uuid,p_workspace uuid,p_bindings uuid[],p_model uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE w tanaghom.agency_workspaces%ROWTYPE; b tanaghom.agency_pilot_bindings%ROWTYPE; t uuid; i integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-claim',0));
 SELECT * INTO w FROM tanaghom.agency_workspaces WHERE id=p_workspace FOR UPDATE;
 PERFORM tanaghom.assert_organization_agent_owner(w.organization_id,p_actor);
 IF w.status<>'draft' THEN RETURN w.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_control WHERE enabled AND NOT emergency_stop)
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop)
 THEN RAISE EXCEPTION 'workspace runtime stopped'; END IF;
 IF p_bindings IS NULL OR cardinality(p_bindings)<>cardinality(w.profile_codes) OR
 NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_profiles WHERE id=p_model AND id IN
  ('7d000000-0000-4000-8000-000000000002','7d000000-0000-4000-8000-000000000003') AND lifecycle_state='validated')
 THEN RAISE EXCEPTION 'workspace bindings or model invalid'; END IF;
 FOR i IN 1..cardinality(w.profile_codes) LOOP
  SELECT * INTO b FROM tanaghom.agency_pilot_bindings WHERE id=p_bindings[i] AND organization_id=w.organization_id
   AND profile_code=w.profile_codes[i];
  IF b.id IS NULL OR NOT EXISTS(SELECT 1 FROM tanaghom.organization_agent_versions a JOIN tanaghom.organization_agent_policies p
    ON p.agent_version_id=a.id WHERE a.id=b.agent_version_id AND a.lifecycle_state IN ('validated','simulation')
    AND w.language=ANY(a.languages) AND p.max_daily_actions=0 AND p.max_retries=0 AND p.monthly_budget=0)
  THEN RAISE EXCEPTION 'workspace agent policy invalid'; END IF;
  INSERT INTO tanaghom.agency_pilot_tasks(organization_id,binding_id,requested_by,model_profile_id,correlation_id,language,target_id,options,idempotency_key,request_hash)
  VALUES(w.organization_id,b.id,p_actor,p_model,w.id,w.language,w.id,
   jsonb_build_object('workspace_contract','agency.workspace.v1','sequence',i),
   'workspace:'||w.id::text||':'||i,w.input_hash) RETURNING id INTO t;
  INSERT INTO tanaghom.agency_workspace_steps VALUES(w.id,i,w.profile_codes[i],t);
  INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
   VALUES(w.organization_id,t,'queued',t,jsonb_build_object('workspace_id',w.id,'sequence',i));
 END LOOP;
 UPDATE tanaghom.agency_workspaces SET status='queued',started_at=now() WHERE id=w.id;
 INSERT INTO tanaghom.agency_workspace_events(organization_id,workspace_id,event_type,actor_kind,actor_ref)
 VALUES(w.organization_id,w.id,'started','human',p_actor::text);
 RETURN w.id;
END $$;

DO $$ DECLARE original text; BEGIN
 SELECT pg_get_functiondef('tanaghom.complete_agency_workspace_task(uuid,uuid,jsonb,text)'::regprocedure) INTO original;
 IF strpos(original,'''model_unavailable'',''workspace_stopped''')=0 THEN
  RAISE EXCEPTION 'unexpected workspace completion definition';
 END IF;
 EXECUTE replace(original,
  '''model_unavailable'',''workspace_stopped''',
  '''model_unavailable'',''workspace_stopped'',''provider_request_rejected'',''provider_quota_exceeded''');
END $$;

-- Model-scoped claiming. A worker claims only tasks whose model profile it
-- actually holds credentials for, so a queued task for an unconfigured model
-- stays queued for a capable worker instead of failing every claim attempt.
-- The earlier guard raised instead, which halted mixed-model queues on any
-- worker that did not hold every model in the queue.
CREATE FUNCTION tanaghom.claim_agency_workspace_task_for_models(p_models uuid[])
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
  UPDATE tanaghom.agency_workspace_control SET emergency_stop=true,reason='An inference lease expired; operator review required before further requests',updated_at=now();
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
 AND x.started_at>now()-interval '24 hours' AND v.lifecycle_state IN ('validated','simulation')
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
 UPDATE tanaghom.agency_pilot_tasks SET status='in_progress',attempt=1,lease_token=gen_random_uuid(),claimed_at=now(),lease_expires_at=now()+interval '180 seconds',
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
REVOKE ALL ON FUNCTION tanaghom.claim_agency_workspace_task_for_models(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.claim_agency_workspace_task_for_models(uuid[]) TO tanaghom_agency_pilot_worker;

INSERT INTO public.schema_migrations(version) VALUES('0048_gemini_workspace_model');
COMMIT;
