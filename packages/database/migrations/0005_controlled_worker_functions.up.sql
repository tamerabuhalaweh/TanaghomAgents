BEGIN;

CREATE FUNCTION tanaghom.claim_agent_job(
  p_agent_code text,
  p_job_types text[] DEFAULT NULL
)
RETURNS TABLE (
  job_id uuid,
  correlation_id uuid,
  campaign_id uuid,
  job_type text,
  attempt integer,
  max_attempts integer,
  input jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  IF p_agent_code IS NULL OR p_agent_code !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'valid agent code required';
  END IF;

  SELECT candidate.id INTO v_job_id
  FROM tanaghom.agent_jobs candidate
  JOIN tanaghom.agents agent ON agent.id = candidate.agent_id
  WHERE agent.code = p_agent_code
    AND agent.status <> 'disabled'
    AND candidate.status = 'queued'
    AND candidate.available_at <= statement_timestamp()
    AND candidate.attempt < candidate.max_attempts
    AND (p_job_types IS NULL OR candidate.job_type = ANY(p_job_types))
  ORDER BY candidate.available_at, candidate.created_at
  FOR UPDATE OF candidate SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NULL THEN RETURN; END IF;

  UPDATE tanaghom.agent_jobs job
  SET status = 'running',
      attempt = job.attempt + 1,
      started_at = statement_timestamp(),
      finished_at = NULL,
      error_code = NULL,
      error_message = NULL
  WHERE job.id = v_job_id;

  UPDATE tanaghom.agents agent
  SET status = 'working', last_heartbeat_at = statement_timestamp()
  FROM tanaghom.agent_jobs job
  WHERE job.id = v_job_id AND agent.id = job.agent_id;

  RETURN QUERY
  SELECT job.id, job.correlation_id, job.campaign_id, job.job_type,
         job.attempt, job.max_attempts, job.input
  FROM tanaghom.agent_jobs job
  WHERE job.id = v_job_id;
END;
$$;

CREATE FUNCTION tanaghom.persist_strategy_result(
  p_job_id uuid,
  p_output jsonb,
  p_model_name text,
  p_prompt_version text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_agent_id uuid;
  v_agent_code text;
  v_strategy_id uuid;
  v_version integer;
  v_status text;
BEGIN
  IF p_output IS NULL OR jsonb_typeof(p_output) <> 'object'
     OR p_output->>'contract_version' <> 'phase3.strategist-output.v1' THEN
    RAISE EXCEPTION 'invalid strategist output contract';
  END IF;
  IF length(trim(coalesce(p_model_name, ''))) = 0
     OR length(trim(coalesce(p_prompt_version, ''))) = 0 THEN
    RAISE EXCEPTION 'model and prompt versions are required';
  END IF;

  SELECT job.* INTO v_job
  FROM tanaghom.agent_jobs job
  WHERE job.id = p_job_id
  FOR UPDATE;
  SELECT agent.id, agent.code INTO v_agent_id, v_agent_code
  FROM tanaghom.agents agent WHERE agent.id = v_job.agent_id;

  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'campaign.strategy.generate'
     OR v_agent_code <> 'campaign_strategist'
     OR v_job.campaign_id IS NULL THEN
    RAISE EXCEPTION 'job is not a running strategist job';
  END IF;

  v_status := p_output->>'status';
  IF v_status = 'blocked_missing_info' THEN
    IF jsonb_typeof(p_output->'missing_fields') <> 'array'
       OR jsonb_array_length(p_output->'missing_fields') < 1
       OR length(trim(coalesce(p_output->>'message', ''))) = 0 THEN
      RAISE EXCEPTION 'invalid blocked strategist output';
    END IF;

    UPDATE tanaghom.campaigns
    SET status = 'blocked_missing_info', blocked_reason = p_output->>'message'
    WHERE id = v_job.campaign_id AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign is not ready for missing-info blocking'; END IF;

    UPDATE tanaghom.agent_jobs
    SET status = 'succeeded', output = p_output, finished_at = statement_timestamp()
    WHERE id = p_job_id;
    UPDATE tanaghom.agents SET status = 'blocked', last_heartbeat_at = statement_timestamp()
    WHERE id = v_agent_id;
    INSERT INTO tanaghom.agent_actions_log (
      correlation_id, job_id, agent_id, action_type, entity_type, entity_id,
      payload, result
    ) VALUES (
      v_job.correlation_id, p_job_id, v_agent_id, 'strategy.blocked_missing_info',
      'campaign', v_job.campaign_id,
      jsonb_build_object('missing_fields', p_output->'missing_fields', 'prompt_version', p_prompt_version),
      'blocked_missing_info'
    );
    RETURN NULL;
  END IF;

  IF v_status <> 'ok'
     OR length(trim(coalesce(p_output->>'positioning', ''))) = 0
     OR jsonb_typeof(p_output->'key_messages') <> 'array'
     OR jsonb_array_length(p_output->'key_messages') NOT BETWEEN 3 AND 5
     OR jsonb_typeof(p_output->'channels') <> 'array'
     OR jsonb_array_length(p_output->'channels') < 1
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(p_output->'channels') channel
       WHERE channel NOT IN ('instagram','tiktok','facebook','linkedin','youtube','email','whatsapp_status')
     )
     OR jsonb_typeof(p_output->'posting_cadence') <> 'object'
     OR jsonb_typeof(p_output->'content_pillars') <> 'array'
     OR jsonb_array_length(p_output->'content_pillars') NOT BETWEEN 4 AND 8 THEN
    RAISE EXCEPTION 'invalid successful strategist output';
  END IF;

  PERFORM 1 FROM jsonb_array_elements(p_output->'content_pillars') pillar
  WHERE jsonb_typeof(pillar) <> 'object'
     OR length(trim(coalesce(pillar->>'name', ''))) = 0
     OR length(trim(coalesce(pillar->>'description', ''))) = 0
     OR jsonb_typeof(pillar->'example_angles') <> 'array'
     OR jsonb_array_length(pillar->'example_angles') < 1;
  IF FOUND THEN RAISE EXCEPTION 'invalid content pillar'; END IF;

  PERFORM 1 FROM tanaghom.campaigns
  WHERE id = v_job.campaign_id AND status = 'draft' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign is not ready for strategy persistence'; END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
  FROM tanaghom.campaign_strategies WHERE campaign_id = v_job.campaign_id;

  INSERT INTO tanaghom.campaign_strategies (
    campaign_id, version, positioning, key_messages, channels,
    posting_cadence, content_pillars, model_name, prompt_version
  ) VALUES (
    v_job.campaign_id, v_version, p_output->>'positioning',
    p_output->'key_messages', p_output->'channels', p_output->'posting_cadence',
    p_output->'content_pillars', trim(p_model_name), trim(p_prompt_version)
  ) RETURNING id INTO v_strategy_id;

  UPDATE tanaghom.campaigns
  SET status = 'strategy_ready', blocked_reason = NULL
  WHERE id = v_job.campaign_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign changed before strategy persistence'; END IF;

  UPDATE tanaghom.agent_jobs
  SET status = 'succeeded', output = p_output, finished_at = statement_timestamp()
  WHERE id = p_job_id;
  UPDATE tanaghom.agents SET status = 'idle', last_heartbeat_at = statement_timestamp()
  WHERE id = v_agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_job.correlation_id, p_job_id, v_agent_id, 'strategy.persisted',
    'campaign_strategy', v_strategy_id,
    jsonb_build_object('campaign_id', v_job.campaign_id, 'version', v_version, 'model_name', p_model_name, 'prompt_version', p_prompt_version),
    'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'strategy.persisted:' || p_job_id::text,
    'strategy.persisted', 'campaign_strategy', v_strategy_id,
    jsonb_build_object('campaign_id', v_job.campaign_id, 'strategy_id', v_strategy_id, 'version', v_version)
  );
  RETURN v_strategy_id;
END;
$$;

CREATE FUNCTION tanaghom.persist_content_result(
  p_job_id uuid,
  p_output jsonb,
  p_model_name text,
  p_prompt_version text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_agent_id uuid;
  v_agent_code text;
  v_strategy_id uuid;
  v_strategy tanaghom.campaign_strategies%ROWTYPE;
  v_item jsonb;
  v_count integer;
  v_max_items integer;
  v_parent_id uuid;
  v_generation integer;
  v_inserted_id uuid;
  v_ids jsonb := '[]'::jsonb;
BEGIN
  IF p_output IS NULL OR jsonb_typeof(p_output) <> 'object'
     OR p_output->>'contract_version' <> 'phase3.content-producer-output.v1'
     OR jsonb_typeof(p_output->'items') <> 'array' THEN
    RAISE EXCEPTION 'invalid content producer output contract';
  END IF;
  IF length(trim(coalesce(p_model_name, ''))) = 0
     OR length(trim(coalesce(p_prompt_version, ''))) = 0 THEN
    RAISE EXCEPTION 'model and prompt versions are required';
  END IF;

  SELECT job.* INTO v_job
  FROM tanaghom.agent_jobs job
  WHERE job.id = p_job_id
  FOR UPDATE;
  SELECT agent.id, agent.code INTO v_agent_id, v_agent_code
  FROM tanaghom.agents agent WHERE agent.id = v_job.agent_id;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'campaign.content.generate'
     OR v_agent_code <> 'content_producer'
     OR v_job.campaign_id IS NULL THEN
    RAISE EXCEPTION 'job is not a running content producer job';
  END IF;

  v_count := jsonb_array_length(p_output->'items');
  v_max_items := coalesce((v_job.input->>'max_items')::integer, 0);
  IF v_count < 1 OR v_count > 12 OR v_max_items < 1 OR v_count > v_max_items THEN
    RAISE EXCEPTION 'content item count is outside the job boundary';
  END IF;

  SELECT strategy.* INTO v_strategy
  FROM tanaghom.campaign_strategies strategy
  WHERE strategy.campaign_id = v_job.campaign_id
  ORDER BY strategy.version DESC LIMIT 1
  FOR SHARE;
  IF v_strategy.id IS NULL THEN RAISE EXCEPTION 'persisted strategy required'; END IF;
  v_strategy_id := v_strategy.id;

  IF v_job.input ? 'regeneration' AND v_job.input->'regeneration' IS NOT NULL THEN
    IF v_count <> 1 THEN RAISE EXCEPTION 'regeneration must produce exactly one item'; END IF;
    v_parent_id := (v_job.input->'regeneration'->>'parent_content_id')::uuid;
    v_generation := (v_job.input->'regeneration'->>'generation')::integer;
    PERFORM 1 FROM tanaghom.content_items
    WHERE id = v_parent_id AND campaign_id = v_job.campaign_id AND status = 'rejected';
    IF NOT FOUND OR v_generation < 2 THEN RAISE EXCEPTION 'valid rejected parent required for regeneration'; END IF;
  ELSE
    v_parent_id := NULL;
    v_generation := 1;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_output->'items')
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR v_item->>'content_type' NOT IN ('post','reel_script','ad_copy','email')
       OR length(trim(coalesce(v_item->>'draft_copy', ''))) = 0
       OR length(trim(coalesce(v_item->>'media_brief', ''))) = 0
       OR NOT (v_strategy.channels ? (v_item->>'channel'))
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_strategy.content_pillars) pillar
         WHERE pillar->>'name' = v_item->>'content_pillar'
       ) THEN
      RAISE EXCEPTION 'content item violates persisted strategy';
    END IF;
    IF v_parent_id IS NOT NULL AND (
      v_item->>'channel' <> v_job.input->'regeneration'->>'channel'
      OR v_item->>'content_type' <> v_job.input->'regeneration'->>'content_type'
    ) THEN
      RAISE EXCEPTION 'regeneration changed channel or content type';
    END IF;

    INSERT INTO tanaghom.content_items (
      campaign_id, strategy_id, parent_content_id, generation, channel,
      content_type, draft_copy, media_brief, status
    ) VALUES (
      v_job.campaign_id, v_strategy_id, v_parent_id, v_generation,
      v_item->>'channel', v_item->>'content_type', v_item->>'draft_copy',
      v_item->>'media_brief', 'pending_approval'
    ) RETURNING id INTO v_inserted_id;
    v_ids := v_ids || jsonb_build_array(v_inserted_id);
  END LOOP;

  UPDATE tanaghom.campaigns SET status = 'content_in_progress'
  WHERE id = v_job.campaign_id AND status = 'strategy_ready';
  IF FOUND THEN
    UPDATE tanaghom.campaigns SET status = 'awaiting_approval'
    WHERE id = v_job.campaign_id AND status = 'content_in_progress';
  ELSIF NOT EXISTS (
    SELECT 1 FROM tanaghom.campaigns
    WHERE id = v_job.campaign_id AND status IN ('content_in_progress','awaiting_approval')
  ) THEN
    RAISE EXCEPTION 'campaign is not ready for content persistence';
  ELSE
    UPDATE tanaghom.campaigns SET status = 'awaiting_approval'
    WHERE id = v_job.campaign_id AND status = 'content_in_progress';
  END IF;

  UPDATE tanaghom.agent_jobs
  SET status = 'waiting_approval', output = p_output
  WHERE id = p_job_id;
  UPDATE tanaghom.agents SET status = 'waiting_approval', last_heartbeat_at = statement_timestamp()
  WHERE id = v_agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_job.correlation_id, p_job_id, v_agent_id, 'content.generated',
    'campaign', v_job.campaign_id,
    jsonb_build_object('content_item_ids', v_ids, 'model_name', p_model_name, 'prompt_version', p_prompt_version),
    'blocked_pending_approval'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'content.generated:' || p_job_id::text,
    'content.generated', 'campaign', v_job.campaign_id,
    jsonb_build_object('content_item_ids', v_ids, 'job_id', p_job_id)
  );
  RETURN v_count;
END;
$$;

CREATE FUNCTION tanaghom.record_agent_job_failure(
  p_job_id uuid,
  p_error_code text,
  p_error_message text,
  p_retry_after_seconds integer DEFAULT 60
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_next_status text;
BEGIN
  IF length(trim(coalesce(p_error_code, ''))) = 0
     OR length(trim(coalesce(p_error_message, ''))) = 0
     OR p_retry_after_seconds IS NULL
     OR p_retry_after_seconds < 0 OR p_retry_after_seconds > 86400 THEN
    RAISE EXCEPTION 'valid bounded failure details required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running' THEN
    RAISE EXCEPTION 'job is not running';
  END IF;

  v_next_status := CASE WHEN v_job.attempt < v_job.max_attempts THEN 'queued' ELSE 'failed' END;
  UPDATE tanaghom.agent_jobs
  SET status = v_next_status,
      error_code = left(trim(p_error_code), 120),
      error_message = left(trim(p_error_message), 4000),
      available_at = CASE WHEN v_next_status = 'queued'
        THEN statement_timestamp() + make_interval(secs => p_retry_after_seconds)
        ELSE available_at END,
      finished_at = CASE WHEN v_next_status = 'failed' THEN statement_timestamp() ELSE NULL END
  WHERE id = p_job_id;
  UPDATE tanaghom.agents
  SET status = CASE WHEN v_next_status = 'queued' THEN 'idle' ELSE 'failed' END,
      last_heartbeat_at = statement_timestamp()
  WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_job.correlation_id, p_job_id, v_job.agent_id, 'job.' || v_next_status,
    'agent_job', p_job_id,
    jsonb_build_object('error_code', left(trim(p_error_code), 120), 'attempt', v_job.attempt, 'max_attempts', v_job.max_attempts),
    'failed'
  );
  RETURN v_next_status;
END;
$$;

CREATE FUNCTION tanaghom.complete_content_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_ids jsonb;
BEGIN
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'waiting_approval'
     OR v_job.job_type <> 'campaign.content.generate' THEN
    RAISE EXCEPTION 'job is not waiting for content approval';
  END IF;
  SELECT event.payload->'content_item_ids' INTO v_ids
  FROM tanaghom.outbox_events event
  WHERE event.event_key = 'content.generated:' || p_job_id::text;
  IF jsonb_typeof(v_ids) <> 'array' OR jsonb_array_length(v_ids) < 1 THEN
    RAISE EXCEPTION 'generated content evidence is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_ids) generated(id)
    LEFT JOIN tanaghom.content_items content ON content.id = generated.id::uuid
    WHERE content.id IS NULL OR content.status NOT IN ('approved', 'rejected', 'cancelled')
  ) THEN
    RETURN false;
  END IF;

  UPDATE tanaghom.agent_jobs
  SET status = 'succeeded', finished_at = statement_timestamp()
  WHERE id = p_job_id;
  UPDATE tanaghom.agents
  SET status = 'idle', last_heartbeat_at = statement_timestamp()
  WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_job.correlation_id, p_job_id, v_job.agent_id, 'content.review_completed',
    'agent_job', p_job_id, jsonb_build_object('content_item_ids', v_ids), 'success'
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION tanaghom.claim_agent_job(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.persist_strategy_result(uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.persist_content_result(uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_agent_job_failure(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.complete_content_job(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION tanaghom.claim_agent_job(text, text[]) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.persist_strategy_result(uuid, jsonb, text, text) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.persist_content_result(uuid, jsonb, text, text) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.record_agent_job_failure(uuid, text, text, integer) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.complete_content_job(uuid) TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0005_controlled_worker_functions');

COMMIT;
