BEGIN;

CREATE OR REPLACE FUNCTION tanaghom.claim_ghl_inbound_event_job()
RETURNS TABLE (
  job_id uuid,event_id uuid,correlation_id uuid,organization_id uuid,
  provider_event_type text,attempt integer,max_attempts integer,event_payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE v_job_id uuid;
BEGIN
  SELECT candidate.id INTO v_job_id
    FROM tanaghom.agent_jobs candidate
    JOIN tanaghom.ghl_inbound_events event ON event.id=(candidate.input->>'event_id')::uuid
    JOIN tanaghom.agents agent ON agent.id=candidate.agent_id
    JOIN tanaghom.integration_connections connection
      ON connection.id=event.integration_connection_id
     AND connection.organization_id=event.organization_id
     AND connection.provider='ghl' AND connection.status='connected'
    JOIN tanaghom.organization_crm_policies policy
      ON policy.organization_id=event.organization_id
     AND policy.conversation_processing_mode='shadow'
    JOIN tanaghom.automation_platform_controls control
      ON control.provider='ghl' AND NOT control.emergency_stop
   WHERE candidate.job_type='conversation.ghl.inbound_event'
     AND candidate.status='queued' AND candidate.available_at<=statement_timestamp()
     AND candidate.attempt<candidate.max_attempts
     AND candidate.input->>'contract_version'='phase5.ghl-inbound-event-job.v1'
     AND candidate.input->>'organization_id'=event.organization_id::text
     AND event.status='pending' AND agent.code='sales_crm' AND agent.status<>'disabled'
   ORDER BY candidate.available_at,candidate.created_at
   FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;
  IF v_job_id IS NULL THEN RETURN; END IF;
  UPDATE tanaghom.agent_jobs job SET
    status='running',attempt=job.attempt+1,started_at=statement_timestamp(),
    finished_at=NULL,error_code=NULL,error_message=NULL WHERE id=v_job_id;
  UPDATE tanaghom.ghl_inbound_events event SET
    status='processing',claimed_at=statement_timestamp(),processed_at=NULL,
    last_error_code=NULL,last_error_message=NULL
  FROM tanaghom.agent_jobs job
  WHERE job.id=v_job_id AND event.id=(job.input->>'event_id')::uuid;
  UPDATE tanaghom.agents agent SET status='working',last_heartbeat_at=statement_timestamp()
  FROM tanaghom.agent_jobs job WHERE job.id=v_job_id AND agent.id=job.agent_id;
  RETURN QUERY
  SELECT job.id,event.id,job.correlation_id,event.organization_id,
         event.provider_event_type,job.attempt,job.max_attempts,event.payload
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.ghl_inbound_events event ON event.id=(job.input->>'event_id')::uuid
   WHERE job.id=v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION tanaghom.record_ghl_inbound_event_failure(
  p_job_id uuid,p_error_code text,p_error_message text,p_retry_after_seconds integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
  v_next_job_status text;
  v_next_event_status text;
BEGIN
  IF length(trim(coalesce(p_error_code,''))) NOT BETWEEN 1 AND 120
     OR length(trim(coalesce(p_error_message,''))) NOT BETWEEN 1 AND 4000
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'valid bounded GHL inbound failure required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status<>'running'
     OR v_job.job_type<>'conversation.ghl.inbound_event' THEN
    RAISE EXCEPTION 'job is not a running GHL inbound event job';
  END IF;
  SELECT * INTO v_event FROM tanaghom.ghl_inbound_events
   WHERE id=(v_job.input->>'event_id')::uuid FOR UPDATE;
  IF v_event.id IS NULL OR v_event.status<>'processing' THEN
    RAISE EXCEPTION 'matching GHL inbound event is not processing';
  END IF;
  v_next_job_status:=CASE WHEN v_job.attempt<v_job.max_attempts THEN 'queued' ELSE 'failed' END;
  v_next_event_status:=CASE WHEN v_next_job_status='queued' THEN 'pending' ELSE 'dead_letter' END;
  UPDATE tanaghom.agent_jobs SET status=v_next_job_status,
    error_code=left(trim(p_error_code),120),error_message=left(trim(p_error_message),4000),
    available_at=CASE WHEN v_next_job_status='queued'
      THEN statement_timestamp()+make_interval(secs=>p_retry_after_seconds) ELSE available_at END,
    finished_at=CASE WHEN v_next_job_status='failed' THEN statement_timestamp() ELSE NULL END
  WHERE id=v_job.id;
  UPDATE tanaghom.ghl_inbound_events SET status=v_next_event_status,
    last_error_code=left(trim(p_error_code),120),last_error_message=left(trim(p_error_message),1000),
    processed_at=CASE WHEN v_next_event_status='dead_letter' THEN statement_timestamp() ELSE NULL END
  WHERE id=v_event.id;
  UPDATE tanaghom.agents SET status=CASE WHEN v_next_job_status='queued' THEN 'idle' ELSE 'failed' END,
    last_heartbeat_at=statement_timestamp() WHERE id=v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id,job_id,agent_id,action_type,entity_type,entity_id,payload,result
  ) VALUES (
    v_job.correlation_id,v_job.id,v_job.agent_id,'ghl.inbound_event_failed',
    'ghl_inbound_event',v_event.id,
    jsonb_build_object('error_code',left(trim(p_error_code),120),
      'next_job_status',v_next_job_status,'next_event_status',v_next_event_status),'failed'
  );
  IF v_next_event_status='dead_letter' THEN
    INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
    SELECT app.id,'error','GHL conversation event needs review',
      'An authenticated conversation event exhausted bounded processing retries and entered the dead-letter queue.',
      'ghl_inbound_event',v_event.id FROM tanaghom.app_users app
    WHERE app.organization_id=v_event.organization_id AND app.role='owner'
      AND app.is_active AND app.accepted_at IS NOT NULL;
  END IF;
  RETURN v_next_event_status;
END;
$$;

CREATE OR REPLACE FUNCTION tanaghom.claim_ghl_action_job()
RETURNS TABLE (job_id uuid,action_type text,attempt integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.ghl_action_jobs%ROWTYPE;
BEGIN
  SELECT job.* INTO v_job FROM tanaghom.ghl_action_jobs job
  JOIN tanaghom.organization_crm_policies policy ON policy.organization_id=job.organization_id
  JOIN tanaghom.automation_platform_controls control ON control.provider='ghl'
  JOIN tanaghom.integration_connections connection ON connection.organization_id=job.organization_id
    AND connection.provider='ghl' AND connection.status='connected'
  WHERE job.status='queued' AND job.available_at<=statement_timestamp()
    AND NOT control.emergency_stop AND NOT policy.action_emergency_stop
    AND NOT EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs uncertain
      WHERE uncertain.organization_id=job.organization_id AND uncertain.status='indeterminate')
  ORDER BY job.available_at,job.created_at FOR UPDATE OF job SKIP LOCKED LIMIT 1;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE tanaghom.ghl_action_jobs claimed SET status='claimed',attempt=claimed.attempt+1,
    claimed_at=statement_timestamp() WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN QUERY SELECT v_job.id,v_job.action_type,v_job.attempt;
END;
$$;

CREATE OR REPLACE FUNCTION tanaghom.record_ghl_action_failure(
  p_job_id uuid,p_error_code text,p_error_message text,p_http_status integer,
  p_retry_after_seconds integer DEFAULT 300
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.ghl_action_jobs%ROWTYPE; v_status text;
BEGIN
  IF length(trim(coalesce(p_error_code,'')))<1 OR length(trim(coalesce(p_error_message,'')))<1
     OR p_http_status NOT BETWEEN 0 AND 599 OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'valid bounded GHL action failure required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.ghl_action_jobs WHERE id=p_job_id AND status='dispatching' FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'dispatching GHL action job required'; END IF;
  v_status:=CASE WHEN p_http_status=0 OR p_http_status=408 OR p_http_status>=500 THEN 'indeterminate'
    WHEN p_http_status=429 AND v_job.attempt<v_job.max_attempts THEN 'queued' ELSE 'failed' END;
  UPDATE tanaghom.external_operations SET status=CASE WHEN v_status='indeterminate' THEN 'indeterminate' ELSE 'failed' END,
    response_summary=jsonb_build_object('error_code',left(trim(p_error_code),120),'http_status',p_http_status)
    WHERE id=v_job.external_operation_id AND status='in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'matching GHL provider operation is not in progress'; END IF;
  UPDATE tanaghom.ghl_action_jobs SET status=v_status,error_code=left(trim(p_error_code),120),
    error_message=left(trim(p_error_message),4000),available_at=CASE WHEN v_status='queued'
      THEN statement_timestamp()+make_interval(secs=>p_retry_after_seconds) ELSE available_at END,
    finished_at=CASE WHEN v_status IN ('failed','indeterminate') THEN statement_timestamp() END WHERE id=v_job.id;
  INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
  VALUES (v_job.organization_id,v_job.id,CASE WHEN v_status='queued' THEN 'failed' ELSE v_status END,
    jsonb_build_object('error_code',left(trim(p_error_code),120),
    'http_status',p_http_status,'blind_retry_allowed',v_status='queued'));
  IF v_status='indeterminate' THEN
    INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
    SELECT app.id,'critical','GHL action requires reconciliation',
      'A provider operation timed out after dispatch. Automation is blocked until a human reconciles the outcome.',
      'ghl_action_job',v_job.id FROM tanaghom.app_users app WHERE app.organization_id=v_job.organization_id
      AND app.kind='human' AND app.role='owner' AND app.is_active AND app.accepted_at IS NOT NULL;
  END IF;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION tanaghom.claim_ghl_inbound_event_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_inbound_event_failure(uuid,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_ghl_action_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_inbound_event_job(),
  tanaghom.record_ghl_inbound_event_failure(uuid,text,text,integer)
  TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_action_job(),
  tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer)
  TO tanaghom_n8n_worker;

DROP VIEW tanaghom.conversation_capacity_status;
DROP FUNCTION tanaghom.set_conversation_capacity_policy(uuid,integer,integer,integer,integer,integer,integer,uuid);
DROP TRIGGER organizations_create_conversation_capacity_policy ON tanaghom.organizations;
DROP FUNCTION tanaghom.create_default_conversation_capacity_policy();
DROP TRIGGER agent_jobs_annotate_conversation_capacity ON tanaghom.agent_jobs;
DROP FUNCTION tanaghom.annotate_conversation_job_capacity();
UPDATE tanaghom.agent_jobs SET input=(input-'workload_class')-'priority_score'
WHERE job_type='conversation.ghl.inbound_event';
DROP TRIGGER ghl_inbound_events_classify_workload ON tanaghom.ghl_inbound_events;
DROP FUNCTION tanaghom.classify_ghl_inbound_workload();
DROP INDEX tanaghom.ghl_action_jobs_capacity_idx;
DROP INDEX tanaghom.agent_jobs_conversation_priority_idx;
DROP INDEX tanaghom.agent_jobs_conversation_capacity_idx;
DROP INDEX tanaghom.ghl_inbound_events_capacity_queue_idx;
DROP INDEX tanaghom.ghl_inbound_events_priority_claim_idx;
ALTER TABLE tanaghom.ghl_inbound_events DROP COLUMN priority_score,DROP COLUMN workload_class;
DROP TABLE tanaghom.conversation_dependency_cooldowns;
DROP TABLE tanaghom.conversation_capacity_policies;

DELETE FROM public.schema_migrations
WHERE version='0018_conversation_capacity_backpressure';

COMMIT;
