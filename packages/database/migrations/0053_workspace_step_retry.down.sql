BEGIN;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.schema_migrations) <> 50
 OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0053_workspace_step_retry'
 THEN RAISE EXCEPTION '0053 down requires exact 0053 baseline'; END IF;
 IF EXISTS(SELECT 1 FROM tanaghom.agency_pilot_tasks WHERE idempotency_key LIKE 'workspace:%:retry:%')
 THEN RAISE EXCEPTION '0053 down refuses retained step-retry evidence'; END IF;
END $$;

DROP TRIGGER workspace_steps_immutable ON tanaghom.agency_workspace_steps;
CREATE TRIGGER workspace_steps_immutable BEFORE UPDATE OR DELETE ON tanaghom.agency_workspace_steps
 FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
DROP FUNCTION tanaghom.guard_agency_workspace_step();

CREATE OR REPLACE FUNCTION tanaghom.complete_agency_workspace_task(p_task uuid,p_lease uuid,p_result jsonb,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE; w tanaghom.agency_workspaces%ROWTYPE; h text; code text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-claim',0));
 SELECT x.* INTO w FROM tanaghom.agency_workspaces x JOIN tanaghom.agency_workspace_steps s ON s.workspace_id=x.id WHERE s.task_id=p_task FOR UPDATE OF x;
 SELECT * INTO t FROM tanaghom.agency_pilot_tasks WHERE id=p_task FOR UPDATE;
 IF w.id IS NULL OR t.lease_token IS DISTINCT FROM p_lease OR p_lease IS NULL THEN RAISE EXCEPTION 'invalid workspace lease'; END IF;
 h:=tanaghom.agent_runtime_sha256(jsonb_build_array(p_result,p_error));
 IF t.status IN ('succeeded','failed') THEN
  IF t.response_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'workspace completion conflict'; END IF;
  RETURN jsonb_build_object('status',t.status,'replay',true);
 END IF;
 IF t.status<>'in_progress' OR t.lease_expires_at<now() OR w.status NOT IN ('running','paused') THEN RAISE EXCEPTION 'workspace task no longer current'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=w.requested_by AND kind='human' AND role='owner' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_bindings b JOIN tanaghom.organization_agent_versions v ON v.id=b.agent_version_id
 JOIN tanaghom.organization_agent_policies p ON p.agent_version_id=v.id WHERE b.id=t.binding_id AND v.lifecycle_state IN ('validated','simulation') AND p.max_daily_actions=0 AND p.max_retries=0)
 THEN RAISE EXCEPTION 'workspace authority revoked'; END IF;
 IF p_error IS NOT NULL AND p_error NOT IN ('inference_failed','inference_outcome_unknown','output_rejected','model_unavailable','workspace_stopped') THEN RAISE EXCEPTION 'unknown workspace failure'; END IF;
 IF p_error IS NULL AND (NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_control WHERE enabled AND NOT emergency_stop)
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop)) THEN RAISE EXCEPTION 'workspace stopped before completion'; END IF;
 SELECT profile_code INTO code FROM tanaghom.agency_workspace_steps WHERE task_id=t.id;
 IF p_error IS NULL AND (p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR length(coalesce(p_result->>'document','')) NOT BETWEEN 20 AND 16000
 OR p_result->>'context_hash' IS DISTINCT FROM t.basis_hash OR (p_result->>'external_actions') IS DISTINCT FROM '0'
 OR p_result->>'kind' IS DISTINCT FROM CASE WHEN code='executive_summary' THEN 'deterministic_summary' ELSE 'model_document' END
 OR p_result->>'procedure_version' IS DISTINCT FROM 'agency.workspace.v1'
 OR p_result->>'human_approved' IS DISTINCT FROM 'false'
 OR coalesce(p_result->>'procedure_hash','') !~ '^[a-f0-9]{64}$'
 OR octet_length(p_result::text)>72000) THEN RAISE EXCEPTION 'invalid workspace artifact'; END IF;
 UPDATE tanaghom.agency_pilot_tasks SET status=CASE WHEN p_error IS NULL THEN 'succeeded' ELSE 'failed' END,
  result=p_result,response_hash=h,error_code=p_error,finished_at=now() WHERE id=t.id;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
 VALUES(w.organization_id,t.id,CASE WHEN p_error IS NULL THEN 'succeeded' ELSE 'failed' END,t.id,jsonb_build_object('response_hash',h,'external_actions',0));
 INSERT INTO tanaghom.agency_workspace_events(organization_id,workspace_id,event_type,actor_kind,actor_ref,evidence)
 VALUES(w.organization_id,w.id,CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,'worker',code,jsonb_build_object('task_id',t.id,'response_hash',h,'error',p_error));
 IF p_error IS NOT NULL THEN
  UPDATE tanaghom.agency_workspaces SET status='failed',error_code=p_error WHERE id=w.id;
  UPDATE tanaghom.agency_workspace_control SET emergency_stop=true,reason='Model request failed; operator review required before new inference',updated_at=now();
 ELSIF w.status<>'paused' AND NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_pilot_tasks a ON a.id=s.task_id WHERE s.workspace_id=w.id AND a.status<>'succeeded') THEN
  UPDATE tanaghom.agency_workspaces SET status='waiting_review' WHERE id=w.id;
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN p_error IS NULL THEN 'succeeded' ELSE 'failed' END,'replay',false);
END $$;

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

CREATE OR REPLACE FUNCTION tanaghom.claim_agency_workspace_task() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE; w tanaghom.agency_workspaces%ROWTYPE; step tanaghom.agency_workspace_steps%ROWTYPE; expired record; memory jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-claim',0));
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

CREATE OR REPLACE FUNCTION tanaghom.decide_agency_workspace(p_actor uuid,p_workspace uuid,p_action text,p_result_hash text,p_feedback text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE w tanaghom.agency_workspaces%ROWTYPE; next_status text; t record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-claim',0));
 SELECT * INTO w FROM tanaghom.agency_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_actor AND organization_id=w.organization_id AND kind='human'
  AND is_active AND accepted_at IS NOT NULL AND (role='owner' OR (role='reviewer' AND p_action IN ('approve','reject'))))
 THEN RAISE EXCEPTION 'workspace human authorization required'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('approve','reject','pause','resume','cancel') OR length(coalesce(p_feedback,''))>2000 THEN RAISE EXCEPTION 'invalid workspace decision'; END IF;
 IF p_action IN ('approve','reject') THEN
  next_status:=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END;
  IF p_result_hash IS DISTINCT FROM tanaghom.agency_workspace_result_hash(w.id) THEN RAISE EXCEPTION 'stale workspace review'; END IF;
  IF w.status=next_status THEN RETURN w.status; END IF;
  IF w.status<>'waiting_review' OR (p_action='reject' AND length(trim(coalesce(p_feedback,'')))<3) THEN RAISE EXCEPTION 'workspace not reviewable or rejection feedback missing'; END IF;
 ELSIF p_action='pause' THEN
  IF w.status='paused' THEN RETURN w.status; END IF;
  IF w.status NOT IN ('queued','running') THEN RAISE EXCEPTION 'workspace not running'; END IF; next_status:='paused';
 ELSIF p_action='resume' THEN
  IF w.status<>'paused' THEN RAISE EXCEPTION 'workspace not paused'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_control WHERE enabled AND NOT emergency_stop)
  OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop) THEN RAISE EXCEPTION 'workspace runtime stopped'; END IF;
  next_status:=CASE WHEN NOT EXISTS(SELECT 1 FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_pilot_tasks task_row ON task_row.id=s.task_id WHERE s.workspace_id=w.id AND task_row.status<>'succeeded') THEN 'waiting_review' ELSE 'queued' END;
 ELSE
  IF w.status='cancelled' THEN RETURN w.status; END IF;
  IF w.status IN ('approved','rejected') THEN RAISE EXCEPTION 'workspace terminal'; END IF;
  next_status:='cancelled';
  FOR t IN SELECT a.* FROM tanaghom.agency_pilot_tasks a JOIN tanaghom.agency_workspace_steps s ON s.task_id=a.id
    WHERE s.workspace_id=w.id AND a.status IN ('queued','in_progress') FOR UPDATE OF a LOOP
   IF t.status='in_progress' THEN
    UPDATE tanaghom.agency_workspace_control SET emergency_stop=true,reason='An in-flight assignment was cancelled; confirm remote completion before new inference',updated_at=now();
   END IF;
   UPDATE tanaghom.agency_pilot_tasks SET status='failed',error_code='workspace_cancelled',finished_at=now(),response_hash=tanaghom.agent_runtime_sha256('"cancelled"'::jsonb) WHERE id=t.id;
   INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence) VALUES(w.organization_id,t.id,'failed',t.id,'{"reason":"workspace_cancelled"}');
  END LOOP;
 END IF;
 UPDATE tanaghom.agency_workspaces SET status=next_status,finished_at=CASE WHEN next_status IN ('approved','rejected','cancelled') THEN now() ELSE finished_at END WHERE id=w.id;
 INSERT INTO tanaghom.agency_workspace_events(organization_id,workspace_id,event_type,actor_kind,actor_ref,evidence)
 VALUES(w.organization_id,w.id,CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'resumed' ELSE 'cancelled' END,
  'human',p_actor::text,jsonb_build_object('result_hash',p_result_hash,'feedback',coalesce(p_feedback,''),'external_actions',0));
 RETURN next_status;
END $$;

REVOKE ALL ON FUNCTION tanaghom.complete_agency_workspace_task(uuid,uuid,jsonb,text),
 tanaghom.claim_agency_workspace_task_for_models(uuid[]),tanaghom.claim_agency_workspace_task(),
 tanaghom.decide_agency_workspace(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.complete_agency_workspace_task(uuid,uuid,jsonb,text),
 tanaghom.claim_agency_workspace_task_for_models(uuid[]),tanaghom.claim_agency_workspace_task()
 TO tanaghom_agency_pilot_worker;
GRANT EXECUTE ON FUNCTION tanaghom.decide_agency_workspace(uuid,uuid,text,text,text) TO tanaghom_api;

DELETE FROM public.schema_migrations WHERE version='0053_workspace_step_retry';
COMMIT;
