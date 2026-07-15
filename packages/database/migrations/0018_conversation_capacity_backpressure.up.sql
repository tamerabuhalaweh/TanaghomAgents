BEGIN;

CREATE TABLE tanaghom.conversation_capacity_policies (
  organization_id uuid PRIMARY KEY REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  max_conversation_concurrency integer NOT NULL DEFAULT 8
    CHECK (max_conversation_concurrency BETWEEN 1 AND 128),
  max_model_claims_per_minute integer NOT NULL DEFAULT 600
    CHECK (max_model_claims_per_minute BETWEEN 1 AND 100000),
  max_ghl_action_concurrency integer NOT NULL DEFAULT 4
    CHECK (max_ghl_action_concurrency BETWEEN 1 AND 64),
  max_ghl_actions_per_minute integer NOT NULL DEFAULT 120
    CHECK (max_ghl_actions_per_minute BETWEEN 1 AND 100000),
  interactive_backlog_threshold integer NOT NULL DEFAULT 100
    CHECK (interactive_backlog_threshold BETWEEN 1 AND 100000),
  queue_age_warning_seconds integer NOT NULL DEFAULT 120
    CHECK (queue_age_warning_seconds BETWEEN 10 AND 86400),
  updated_by uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER conversation_capacity_policies_updated_at
BEFORE UPDATE ON tanaghom.conversation_capacity_policies
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

INSERT INTO tanaghom.conversation_capacity_policies (organization_id)
SELECT organization.id FROM tanaghom.organizations organization;

CREATE FUNCTION tanaghom.create_default_conversation_capacity_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  INSERT INTO tanaghom.conversation_capacity_policies (organization_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_create_conversation_capacity_policy
AFTER INSERT ON tanaghom.organizations
FOR EACH ROW EXECUTE FUNCTION tanaghom.create_default_conversation_capacity_policy();

CREATE TABLE tanaghom.conversation_dependency_cooldowns (
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  dependency text NOT NULL CHECK (dependency IN ('gemma','ghl')),
  blocked_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  pressure_count bigint NOT NULL DEFAULT 1 CHECK (pressure_count > 0),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, dependency)
);

ALTER TABLE tanaghom.ghl_inbound_events
  ADD COLUMN workload_class text NOT NULL DEFAULT 'background'
    CHECK (workload_class IN ('urgent','interactive','background')),
  ADD COLUMN priority_score smallint NOT NULL DEFAULT 20
    CHECK (priority_score BETWEEN 1 AND 200);

UPDATE tanaghom.ghl_inbound_events SET
  workload_class = CASE
    WHEN provider_event_type='ContactDndUpdate' THEN 'urgent'
    WHEN provider_event_type IN ('InboundMessage','ConversationUnreadWebhook') THEN 'interactive'
    ELSE 'background'
  END,
  priority_score = CASE
    WHEN provider_event_type='ContactDndUpdate' THEN 120
    WHEN provider_event_type='InboundMessage' THEN 100
    WHEN provider_event_type='ConversationUnreadWebhook' THEN 80
    ELSE 20
  END;

CREATE FUNCTION tanaghom.classify_ghl_inbound_workload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  NEW.workload_class := CASE
    WHEN NEW.provider_event_type='ContactDndUpdate' THEN 'urgent'
    WHEN NEW.provider_event_type IN ('InboundMessage','ConversationUnreadWebhook') THEN 'interactive'
    ELSE 'background'
  END;
  NEW.priority_score := CASE
    WHEN NEW.provider_event_type='ContactDndUpdate' THEN 120
    WHEN NEW.provider_event_type='InboundMessage' THEN 100
    WHEN NEW.provider_event_type='ConversationUnreadWebhook' THEN 80
    ELSE 20
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_inbound_events_classify_workload
BEFORE INSERT OR UPDATE OF provider_event_type ON tanaghom.ghl_inbound_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.classify_ghl_inbound_workload();

CREATE FUNCTION tanaghom.annotate_conversation_job_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE v_event tanaghom.ghl_inbound_events%ROWTYPE;
BEGIN
  IF NEW.job_type<>'conversation.ghl.inbound_event' THEN RETURN NEW; END IF;
  SELECT * INTO v_event FROM tanaghom.ghl_inbound_events
   WHERE id=(NEW.input->>'event_id')::uuid;
  IF v_event.id IS NULL OR NEW.input->>'organization_id'<>v_event.organization_id::text THEN
    RAISE EXCEPTION 'conversation capacity job does not match its event';
  END IF;
  NEW.input:=NEW.input||jsonb_build_object(
    'workload_class',v_event.workload_class,'priority_score',v_event.priority_score
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_jobs_annotate_conversation_capacity
BEFORE INSERT OR UPDATE OF input,job_type ON tanaghom.agent_jobs
FOR EACH ROW EXECUTE FUNCTION tanaghom.annotate_conversation_job_capacity();

UPDATE tanaghom.agent_jobs job SET input=job.input||jsonb_build_object(
  'workload_class',event.workload_class,'priority_score',event.priority_score
)
FROM tanaghom.ghl_inbound_events event
WHERE job.job_type='conversation.ghl.inbound_event'
  AND event.id=(job.input->>'event_id')::uuid;

CREATE INDEX ghl_inbound_events_priority_claim_idx
  ON tanaghom.ghl_inbound_events(organization_id,status,priority_score DESC,first_received_at)
  WHERE status IN ('pending','processing');
CREATE INDEX ghl_inbound_events_capacity_queue_idx
  ON tanaghom.ghl_inbound_events(organization_id,status,workload_class,priority_score DESC,first_received_at);
CREATE INDEX agent_jobs_conversation_capacity_idx
  ON tanaghom.agent_jobs ((input->>'organization_id'),status,started_at)
  WHERE job_type='conversation.ghl.inbound_event';
CREATE INDEX agent_jobs_conversation_priority_idx
  ON tanaghom.agent_jobs (
    (input->>'organization_id'),status,((input->>'priority_score')::integer) DESC,
    available_at,created_at
  ) WHERE job_type='conversation.ghl.inbound_event';
CREATE INDEX ghl_action_jobs_capacity_idx
  ON tanaghom.ghl_action_jobs(organization_id,status,claimed_at);

CREATE FUNCTION tanaghom.set_conversation_capacity_policy(
  p_organization_id uuid,
  p_max_conversation_concurrency integer,
  p_max_model_claims_per_minute integer,
  p_max_ghl_action_concurrency integer,
  p_max_ghl_actions_per_minute integer,
  p_interactive_backlog_threshold integer,
  p_queue_age_warning_seconds integer,
  p_actor_user_id uuid
)
RETURNS tanaghom.conversation_capacity_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE v_policy tanaghom.conversation_capacity_policies%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users actor
     WHERE actor.id=p_actor_user_id AND actor.organization_id=p_organization_id
       AND actor.kind='human' AND actor.role='owner'
       AND actor.is_active AND actor.accepted_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'active organization owner required'; END IF;

  INSERT INTO tanaghom.conversation_capacity_policies (
    organization_id,max_conversation_concurrency,max_model_claims_per_minute,
    max_ghl_action_concurrency,max_ghl_actions_per_minute,
    interactive_backlog_threshold,queue_age_warning_seconds,updated_by
  ) VALUES (
    p_organization_id,p_max_conversation_concurrency,p_max_model_claims_per_minute,
    p_max_ghl_action_concurrency,p_max_ghl_actions_per_minute,
    p_interactive_backlog_threshold,p_queue_age_warning_seconds,p_actor_user_id
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    max_conversation_concurrency=EXCLUDED.max_conversation_concurrency,
    max_model_claims_per_minute=EXCLUDED.max_model_claims_per_minute,
    max_ghl_action_concurrency=EXCLUDED.max_ghl_action_concurrency,
    max_ghl_actions_per_minute=EXCLUDED.max_ghl_actions_per_minute,
    interactive_backlog_threshold=EXCLUDED.interactive_backlog_threshold,
    queue_age_warning_seconds=EXCLUDED.queue_age_warning_seconds,
    updated_by=EXCLUDED.updated_by
  RETURNING * INTO v_policy;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result
  ) VALUES (
    gen_random_uuid(),p_actor_user_id,'capacity.policy_updated','organization',p_organization_id,
    jsonb_build_object(
      'max_conversation_concurrency',v_policy.max_conversation_concurrency,
      'max_model_claims_per_minute',v_policy.max_model_claims_per_minute,
      'max_ghl_action_concurrency',v_policy.max_ghl_action_concurrency,
      'max_ghl_actions_per_minute',v_policy.max_ghl_actions_per_minute,
      'interactive_backlog_threshold',v_policy.interactive_backlog_threshold,
      'queue_age_warning_seconds',v_policy.queue_age_warning_seconds
    ),'success'
  );
  RETURN v_policy;
END;
$$;

CREATE OR REPLACE FUNCTION tanaghom.claim_ghl_inbound_event_job()
RETURNS TABLE (
  job_id uuid,event_id uuid,correlation_id uuid,organization_id uuid,
  provider_event_type text,attempt integer,max_attempts integer,event_payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_job_id uuid;
  v_organization_id uuid;
  v_max_concurrency integer;
  v_max_rate integer;
BEGIN
  SELECT capacity.organization_id,capacity.max_conversation_concurrency,
         capacity.max_model_claims_per_minute
    INTO v_organization_id,v_max_concurrency,v_max_rate
    FROM tanaghom.conversation_capacity_policies capacity
    JOIN tanaghom.organization_crm_policies policy
      ON policy.organization_id=capacity.organization_id
     AND policy.conversation_processing_mode='shadow'
    JOIN tanaghom.automation_platform_controls control
      ON control.provider='ghl' AND NOT control.emergency_stop
    JOIN tanaghom.integration_connections connection
      ON connection.organization_id=capacity.organization_id
     AND connection.provider='ghl' AND connection.status='connected'
   WHERE NOT EXISTS (
       SELECT 1 FROM tanaghom.conversation_dependency_cooldowns cooldown
        WHERE cooldown.organization_id=capacity.organization_id
          AND cooldown.dependency='gemma' AND cooldown.blocked_until>statement_timestamp()
     )
     AND (SELECT count(*) FROM tanaghom.agent_jobs running
          WHERE running.job_type='conversation.ghl.inbound_event'
            AND running.status='running'
            AND running.input->>'organization_id'=capacity.organization_id::text)
         < capacity.max_conversation_concurrency
     AND (SELECT count(*) FROM tanaghom.agent_jobs recent
          WHERE recent.job_type='conversation.ghl.inbound_event'
            AND recent.started_at>=statement_timestamp()-interval '1 minute'
            AND recent.input->>'organization_id'=capacity.organization_id::text)
         < capacity.max_model_claims_per_minute
     AND EXISTS (
       SELECT 1 FROM tanaghom.agent_jobs candidate
        WHERE candidate.input->>'organization_id'=capacity.organization_id::text
          AND candidate.job_type='conversation.ghl.inbound_event'
          AND candidate.status='queued' AND candidate.available_at<=statement_timestamp()
          AND candidate.attempt<candidate.max_attempts
     )
   ORDER BY (
     SELECT max((candidate.input->>'priority_score')::integer) FROM tanaghom.agent_jobs candidate
      WHERE candidate.job_type='conversation.ghl.inbound_event'
        AND candidate.input->>'organization_id'=capacity.organization_id::text
        AND candidate.status='queued' AND candidate.available_at<=statement_timestamp()
   ) DESC NULLS LAST,(
     SELECT min(candidate.created_at) FROM tanaghom.agent_jobs candidate
      WHERE candidate.job_type='conversation.ghl.inbound_event'
        AND candidate.input->>'organization_id'=capacity.organization_id::text
        AND candidate.status='queued' AND candidate.available_at<=statement_timestamp()
   )
   LIMIT 1;

  IF v_organization_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tanaghom.capacity.'||v_organization_id::text,0));

  IF (SELECT count(*) FROM tanaghom.agent_jobs running
      WHERE running.job_type='conversation.ghl.inbound_event'
        AND running.status='running'
        AND running.input->>'organization_id'=v_organization_id::text) >= v_max_concurrency
     OR (SELECT count(*) FROM tanaghom.agent_jobs recent
         WHERE recent.job_type='conversation.ghl.inbound_event'
           AND recent.started_at>=statement_timestamp()-interval '1 minute'
           AND recent.input->>'organization_id'=v_organization_id::text) >= v_max_rate
     OR EXISTS (SELECT 1 FROM tanaghom.conversation_dependency_cooldowns cooldown
          WHERE cooldown.organization_id=v_organization_id AND cooldown.dependency='gemma'
            AND cooldown.blocked_until>statement_timestamp())
     OR NOT EXISTS (
       SELECT 1 FROM tanaghom.organization_crm_policies policy
       JOIN tanaghom.automation_platform_controls control ON control.provider='ghl'
       JOIN tanaghom.integration_connections connection
         ON connection.organization_id=policy.organization_id
        AND connection.provider='ghl' AND connection.status='connected'
       WHERE policy.organization_id=v_organization_id
         AND policy.conversation_processing_mode='shadow' AND NOT control.emergency_stop
     ) THEN
    RETURN;
  END IF;

  SELECT candidate.id INTO v_job_id
    FROM tanaghom.agent_jobs candidate
    JOIN tanaghom.agents agent ON agent.id=candidate.agent_id
   WHERE candidate.input->>'organization_id'=v_organization_id::text
     AND candidate.job_type='conversation.ghl.inbound_event'
     AND candidate.status='queued' AND candidate.available_at<=statement_timestamp()
     AND candidate.attempt<candidate.max_attempts
     AND candidate.input->>'contract_version'='phase5.ghl-inbound-event-job.v1'
     AND agent.code='sales_crm' AND agent.status<>'disabled'
     AND EXISTS (SELECT 1 FROM tanaghom.ghl_inbound_events event
       WHERE event.id=(candidate.input->>'event_id')::uuid
         AND event.organization_id=v_organization_id AND event.status='pending')
   ORDER BY (candidate.input->>'priority_score')::integer DESC,
     candidate.available_at,candidate.created_at
   FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;

  IF v_job_id IS NULL THEN RETURN; END IF;

  UPDATE tanaghom.agent_jobs job SET
    status='running',attempt=job.attempt+1,started_at=statement_timestamp(),
    finished_at=NULL,error_code=NULL,error_message=NULL
  WHERE id=v_job_id;
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
  v_dependency text;
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
  v_dependency:=CASE
    WHEN p_error_code IN ('gemma_rate_limited','gemma_unavailable','gemma_overloaded') THEN 'gemma'
    WHEN p_error_code='ghl_rate_limited' THEN 'ghl'
  END;

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

  IF v_dependency IS NOT NULL AND v_next_job_status='queued' THEN
    INSERT INTO tanaghom.conversation_dependency_cooldowns (
      organization_id,dependency,blocked_until,reason,pressure_count,last_observed_at
    ) VALUES (
      v_event.organization_id,v_dependency,
      statement_timestamp()+make_interval(secs=>greatest(p_retry_after_seconds,1)),
      left(trim(p_error_message),500),1,statement_timestamp()
    ) ON CONFLICT (organization_id,dependency) DO UPDATE SET
      blocked_until=greatest(tanaghom.conversation_dependency_cooldowns.blocked_until,EXCLUDED.blocked_until),
      reason=EXCLUDED.reason,
      pressure_count=tanaghom.conversation_dependency_cooldowns.pressure_count+1,
      last_observed_at=statement_timestamp();
  END IF;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id,job_id,agent_id,action_type,entity_type,entity_id,payload,result
  ) VALUES (
    v_job.correlation_id,v_job.id,v_job.agent_id,'ghl.inbound_event_failed',
    'ghl_inbound_event',v_event.id,
    jsonb_build_object('error_code',left(trim(p_error_code),120),
      'next_job_status',v_next_job_status,'next_event_status',v_next_event_status,
      'dependency_cooldown',v_dependency),'failed'
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
DECLARE
  v_job tanaghom.ghl_action_jobs%ROWTYPE;
  v_organization_id uuid;
  v_max_concurrency integer;
  v_max_rate integer;
BEGIN
  SELECT capacity.organization_id,capacity.max_ghl_action_concurrency,
         capacity.max_ghl_actions_per_minute
    INTO v_organization_id,v_max_concurrency,v_max_rate
  FROM tanaghom.conversation_capacity_policies capacity
  JOIN tanaghom.organization_crm_policies policy ON policy.organization_id=capacity.organization_id
  JOIN tanaghom.automation_platform_controls control ON control.provider='ghl'
  JOIN tanaghom.integration_connections connection ON connection.organization_id=capacity.organization_id
    AND connection.provider='ghl' AND connection.status='connected'
  WHERE NOT control.emergency_stop AND NOT policy.action_emergency_stop
    AND NOT EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs uncertain
      WHERE uncertain.organization_id=capacity.organization_id AND uncertain.status='indeterminate')
    AND NOT EXISTS (SELECT 1 FROM tanaghom.conversation_dependency_cooldowns cooldown
      WHERE cooldown.organization_id=capacity.organization_id AND cooldown.dependency='ghl'
        AND cooldown.blocked_until>statement_timestamp())
    AND (SELECT count(*) FROM tanaghom.ghl_action_jobs active
      WHERE active.organization_id=capacity.organization_id AND active.status IN ('claimed','dispatching'))
      < capacity.max_ghl_action_concurrency
    AND (SELECT count(*) FROM tanaghom.ghl_action_jobs recent
      WHERE recent.organization_id=capacity.organization_id
        AND recent.claimed_at>=statement_timestamp()-interval '1 minute')
      < capacity.max_ghl_actions_per_minute
    AND EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs queued
      WHERE queued.organization_id=capacity.organization_id
        AND queued.status='queued' AND queued.available_at<=statement_timestamp())
  ORDER BY (SELECT max(CASE
      WHEN queued.action_type='message' AND queued.direction='inbound' THEN 120
      WHEN queued.action_type='qualification' THEN 100
      WHEN queued.action_type IN ('appointment','opportunity') THEN 80
      WHEN queued.action_type='message' THEN 60 ELSE 20 END)
    FROM tanaghom.ghl_action_jobs queued
    WHERE queued.organization_id=capacity.organization_id
      AND queued.status='queued' AND queued.available_at<=statement_timestamp()) DESC NULLS LAST
  LIMIT 1;
  IF v_organization_id IS NULL THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tanaghom.capacity.'||v_organization_id::text,0));
  IF (SELECT count(*) FROM tanaghom.ghl_action_jobs active
       WHERE active.organization_id=v_organization_id AND active.status IN ('claimed','dispatching')) >= v_max_concurrency
     OR (SELECT count(*) FROM tanaghom.ghl_action_jobs recent
          WHERE recent.organization_id=v_organization_id
            AND recent.claimed_at>=statement_timestamp()-interval '1 minute') >= v_max_rate
     OR EXISTS (SELECT 1 FROM tanaghom.conversation_dependency_cooldowns cooldown
          WHERE cooldown.organization_id=v_organization_id AND cooldown.dependency='ghl'
            AND cooldown.blocked_until>statement_timestamp())
     OR EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs uncertain
          WHERE uncertain.organization_id=v_organization_id AND uncertain.status='indeterminate')
     OR NOT EXISTS (
       SELECT 1 FROM tanaghom.organization_crm_policies policy
       JOIN tanaghom.automation_platform_controls control ON control.provider='ghl'
       JOIN tanaghom.integration_connections connection
         ON connection.organization_id=policy.organization_id
        AND connection.provider='ghl' AND connection.status='connected'
       WHERE policy.organization_id=v_organization_id
         AND NOT policy.action_emergency_stop AND NOT control.emergency_stop
     ) THEN
    RETURN;
  END IF;

  SELECT job.* INTO v_job FROM tanaghom.ghl_action_jobs job
   WHERE job.organization_id=v_organization_id
     AND job.status='queued' AND job.available_at<=statement_timestamp()
   ORDER BY CASE
      WHEN job.action_type='message' AND job.direction='inbound' THEN 120
      WHEN job.action_type='qualification' THEN 100
      WHEN job.action_type IN ('appointment','opportunity') THEN 80
      WHEN job.action_type='message' THEN 60 ELSE 20 END DESC,
    job.available_at,job.created_at
   FOR UPDATE OF job SKIP LOCKED LIMIT 1;
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
  IF p_http_status=429 AND v_status='queued' THEN
    INSERT INTO tanaghom.conversation_dependency_cooldowns (
      organization_id,dependency,blocked_until,reason,pressure_count,last_observed_at
    ) VALUES (
      v_job.organization_id,'ghl',statement_timestamp()+make_interval(secs=>greatest(p_retry_after_seconds,1)),
      left(trim(p_error_message),500),1,statement_timestamp()
    ) ON CONFLICT (organization_id,dependency) DO UPDATE SET
      blocked_until=greatest(tanaghom.conversation_dependency_cooldowns.blocked_until,EXCLUDED.blocked_until),
      reason=EXCLUDED.reason,
      pressure_count=tanaghom.conversation_dependency_cooldowns.pressure_count+1,
      last_observed_at=statement_timestamp();
  END IF;
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

CREATE VIEW tanaghom.conversation_capacity_status AS
WITH inbound AS (
  SELECT event.organization_id,
    count(*) FILTER (WHERE event.status='pending')::bigint AS queue_depth,
    count(*) FILTER (WHERE event.status='pending' AND event.workload_class='urgent')::bigint AS urgent_depth,
    count(*) FILTER (WHERE event.status='pending' AND event.workload_class='interactive')::bigint AS interactive_depth,
    count(*) FILTER (WHERE event.status='pending' AND event.workload_class='background')::bigint AS background_depth,
    count(*) FILTER (WHERE event.status='processing')::bigint AS processing_count,
    count(*) FILTER (WHERE event.status='dead_letter')::bigint AS dead_letter_count,
    coalesce(extract(epoch FROM statement_timestamp()-min(event.first_received_at)
      FILTER (WHERE event.status='pending')),0)::bigint AS oldest_queue_age_seconds
  FROM tanaghom.ghl_inbound_events event GROUP BY event.organization_id
), action_state AS (
  SELECT action.organization_id,
    count(*) FILTER (WHERE action.status='queued')::bigint AS ghl_action_queue_depth,
    count(*) FILTER (WHERE action.status IN ('claimed','dispatching'))::bigint AS ghl_actions_in_flight,
    count(*) FILTER (WHERE action.status='indeterminate')::bigint AS indeterminate_actions
  FROM tanaghom.ghl_action_jobs action GROUP BY action.organization_id
), cooldown AS (
  SELECT state.organization_id,
    max(state.blocked_until) FILTER (WHERE state.dependency='gemma' AND state.blocked_until>statement_timestamp()) AS gemma_blocked_until,
    max(state.blocked_until) FILTER (WHERE state.dependency='ghl' AND state.blocked_until>statement_timestamp()) AS ghl_blocked_until
  FROM tanaghom.conversation_dependency_cooldowns state GROUP BY state.organization_id
)
SELECT organization.id AS organization_id,
  coalesce(inbound.queue_depth,0)::bigint AS queue_depth,
  coalesce(inbound.urgent_depth,0)::bigint AS urgent_depth,
  coalesce(inbound.interactive_depth,0)::bigint AS interactive_depth,
  coalesce(inbound.background_depth,0)::bigint AS background_depth,
  coalesce(inbound.processing_count,0)::bigint AS processing_count,
  coalesce(inbound.dead_letter_count,0)::bigint AS dead_letter_count,
  coalesce(inbound.oldest_queue_age_seconds,0)::bigint AS oldest_queue_age_seconds,
  coalesce(action_state.ghl_action_queue_depth,0)::bigint AS ghl_action_queue_depth,
  coalesce(action_state.ghl_actions_in_flight,0)::bigint AS ghl_actions_in_flight,
  coalesce(action_state.indeterminate_actions,0)::bigint AS indeterminate_actions,
  coalesce(policy.max_conversation_concurrency,8) AS max_conversation_concurrency,
  coalesce(policy.max_model_claims_per_minute,600) AS max_model_claims_per_minute,
  coalesce(policy.max_ghl_action_concurrency,4) AS max_ghl_action_concurrency,
  coalesce(policy.max_ghl_actions_per_minute,120) AS max_ghl_actions_per_minute,
  coalesce(policy.interactive_backlog_threshold,100) AS interactive_backlog_threshold,
  coalesce(policy.queue_age_warning_seconds,120) AS queue_age_warning_seconds,
  cooldown.gemma_blocked_until,cooldown.ghl_blocked_until,
  CASE
    WHEN cooldown.gemma_blocked_until IS NOT NULL OR cooldown.ghl_blocked_until IS NOT NULL THEN 'dependency_cooldown'
    WHEN coalesce(action_state.indeterminate_actions,0)>0 THEN 'indeterminate_block'
    WHEN coalesce(inbound.processing_count,0)>=coalesce(policy.max_conversation_concurrency,8) THEN 'conversation_saturated'
    WHEN coalesce(inbound.interactive_depth,0)+coalesce(inbound.urgent_depth,0)>=coalesce(policy.interactive_backlog_threshold,100) THEN 'protecting_interactive'
    WHEN coalesce(inbound.oldest_queue_age_seconds,0)>=coalesce(policy.queue_age_warning_seconds,120) THEN 'queue_age_warning'
    ELSE 'normal'
  END AS capacity_state
FROM tanaghom.organizations organization
LEFT JOIN inbound ON inbound.organization_id=organization.id
LEFT JOIN action_state ON action_state.organization_id=organization.id
LEFT JOIN tanaghom.conversation_capacity_policies policy ON policy.organization_id=organization.id
LEFT JOIN cooldown ON cooldown.organization_id=organization.id;

REVOKE ALL ON tanaghom.conversation_capacity_policies,tanaghom.conversation_dependency_cooldowns,
  tanaghom.conversation_capacity_status FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON FUNCTION tanaghom.create_default_conversation_capacity_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.classify_ghl_inbound_workload() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.annotate_conversation_job_capacity() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.set_conversation_capacity_policy(uuid,integer,integer,integer,integer,integer,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_ghl_inbound_event_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_inbound_event_failure(uuid,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_ghl_action_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer) FROM PUBLIC;

GRANT SELECT ON tanaghom.conversation_capacity_policies,tanaghom.conversation_capacity_status
  TO tanaghom_api,tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.set_conversation_capacity_policy(uuid,integer,integer,integer,integer,integer,integer,uuid)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_inbound_event_job(),
  tanaghom.record_ghl_inbound_event_failure(uuid,text,text,integer)
  TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_action_job(),
  tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer)
  TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0018_conversation_capacity_backpressure');

COMMIT;
