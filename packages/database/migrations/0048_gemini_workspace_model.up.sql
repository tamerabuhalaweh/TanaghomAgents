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
      AND planner_schema_hash='33c83ccab358eab21d62a592f5d010a5ada4fb953031f3a40a6051fa3c3301ac'
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
  'gemini_2_5_flash_workspace_v1',
  'gemini-2.5-flash',
  'agency.workspace.document.v1',
  'config/agency-workspace.v1.json',
  '33c83ccab358eab21d62a592f5d010a5ada4fb953031f3a40a6051fa3c3301ac',
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
 NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_profiles WHERE id=p_model AND id='7d000000-0000-4000-8000-000000000003' AND lifecycle_state='validated')
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

INSERT INTO public.schema_migrations(version) VALUES('0048_gemini_workspace_model');
COMMIT;
