BEGIN;

ALTER TABLE tanaghom.posts
  DROP CONSTRAINT posts_status_check,
  ADD CONSTRAINT posts_status_check
    CHECK (status IN ('draft', 'scheduled', 'live', 'failed', 'removed'));

CREATE TABLE tanaghom.publishing_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('postiz')),
  channel text NOT NULL CHECK (length(trim(channel)) > 0),
  provider_integration_id text NOT NULL CHECK (length(trim(provider_integration_id)) > 0),
  provider_settings jsonb NOT NULL CHECK (jsonb_typeof(provider_settings) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, channel),
  UNIQUE (provider, provider_integration_id)
);

CREATE TRIGGER publishing_channels_updated_at
BEFORE UPDATE ON tanaghom.publishing_channels
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE UNIQUE INDEX agent_jobs_postiz_content_uidx
  ON tanaghom.agent_jobs ((input->>'content_item_id'))
  WHERE job_type = 'content.postiz.draft';

CREATE FUNCTION tanaghom.queue_postiz_draft(
  p_content_item_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (job_id uuid, correlation_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_campaign_id uuid;
  v_status text;
  v_agent_id uuid;
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  PERFORM 1
  FROM tanaghom.app_users actor
  WHERE actor.id = p_actor_user_id
    AND actor.kind = 'human'
    AND actor.role IN ('owner', 'reviewer', 'operator')
    AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'active publishing operator required'; END IF;

  SELECT content.campaign_id, content.status
  INTO v_campaign_id, v_status
  FROM tanaghom.content_items content
  WHERE content.id = p_content_item_id
  FOR UPDATE;
  IF v_campaign_id IS NULL THEN RAISE EXCEPTION 'content item not found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'approved content required'; END IF;

  PERFORM 1
  FROM tanaghom.content_approvals approval
  JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
  WHERE approval.content_item_id = p_content_item_id
    AND approval.decision = 'approved'
    AND reviewer.kind = 'human'
    AND reviewer.role IN ('owner', 'reviewer')
    AND reviewer.is_active
    AND reviewer.accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'active human approval evidence required'; END IF;

  PERFORM 1
  FROM tanaghom.content_items content
  JOIN tanaghom.publishing_channels mapping
    ON mapping.provider = 'postiz'
   AND mapping.channel = content.channel
   AND mapping.is_active
  WHERE content.id = p_content_item_id
    AND length(trim(coalesce(mapping.provider_settings->>'__type', ''))) > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'active Postiz channel mapping required'; END IF;

  SELECT job.* INTO v_job
  FROM tanaghom.agent_jobs job
  WHERE job.job_type = 'content.postiz.draft'
    AND job.input->>'content_item_id' = p_content_item_id::text;
  IF v_job.id IS NOT NULL THEN
    RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
    RETURN;
  END IF;

  SELECT agent.id INTO v_agent_id
  FROM tanaghom.agents agent
  WHERE agent.code = 'publisher_monitor' AND agent.status <> 'disabled';
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'publisher agent is unavailable'; END IF;

  INSERT INTO tanaghom.agent_jobs (
    correlation_id, agent_id, campaign_id, job_type, max_attempts, input
  ) VALUES (
    v_correlation_id, v_agent_id, v_campaign_id, 'content.postiz.draft', 3,
    jsonb_build_object(
      'contract_version', 'phase4.postiz-draft-job.v1',
      'content_item_id', p_content_item_id,
      'requested_by', p_actor_user_id
    )
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type,
    entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, p_actor_user_id,
    'postiz.draft_requested', 'content_item', p_content_item_id,
    jsonb_build_object('job_id', v_job.id, 'campaign_id', v_campaign_id),
    'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'postiz.draft_requested:' || v_job.id::text,
    'postiz.draft_requested', 'content_item', p_content_item_id,
    jsonb_build_object('job_id', v_job.id, 'content_item_id', p_content_item_id)
  );

  RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
END;
$$;

CREATE FUNCTION tanaghom.prepare_postiz_draft(p_job_id uuid)
RETURNS TABLE (
  job_id uuid,
  operation_id uuid,
  content_item_id uuid,
  campaign_id uuid,
  channel text,
  idempotency_key text,
  request_body jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_agent_code text;
  v_content tanaghom.content_items%ROWTYPE;
  v_channel tanaghom.publishing_channels%ROWTYPE;
  v_operation tanaghom.external_operations%ROWTYPE;
  v_request jsonb;
  v_idempotency_key text;
BEGIN
  SELECT job.* INTO v_job
  FROM tanaghom.agent_jobs job
  WHERE job.id = p_job_id
  FOR UPDATE;
  SELECT agent.code INTO v_agent_code
  FROM tanaghom.agents agent WHERE agent.id = v_job.agent_id;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'content.postiz.draft'
     OR v_agent_code <> 'publisher_monitor'
     OR v_job.input->>'contract_version' <> 'phase4.postiz-draft-job.v1' THEN
    RAISE EXCEPTION 'job is not a running Postiz draft job';
  END IF;

  SELECT content.* INTO v_content
  FROM tanaghom.content_items content
  WHERE content.id = (v_job.input->>'content_item_id')::uuid
    AND content.campaign_id = v_job.campaign_id
  FOR UPDATE;
  IF v_content.id IS NULL OR v_content.status <> 'approved' THEN
    RAISE EXCEPTION 'content is no longer approved';
  END IF;
  PERFORM 1
  FROM tanaghom.content_approvals approval
  JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
  WHERE approval.content_item_id = v_content.id
    AND approval.decision = 'approved'
    AND reviewer.kind = 'human'
    AND reviewer.role IN ('owner', 'reviewer')
    AND reviewer.is_active
    AND reviewer.accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'active human approval evidence required'; END IF;

  SELECT mapping.* INTO v_channel
  FROM tanaghom.publishing_channels mapping
  WHERE mapping.provider = 'postiz'
    AND mapping.channel = v_content.channel
    AND mapping.is_active
  FOR SHARE;
  IF v_channel.id IS NULL OR length(trim(coalesce(v_channel.provider_settings->>'__type', ''))) = 0 THEN
    RAISE EXCEPTION 'active Postiz channel mapping required';
  END IF;

  v_idempotency_key := 'postiz-draft:' || v_content.id::text;
  v_request := jsonb_build_object(
    'type', 'draft',
    'date', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'shortLink', false,
    'tags', jsonb_build_array(),
    'posts', jsonb_build_array(jsonb_build_object(
      'integration', jsonb_build_object('id', v_channel.provider_integration_id),
      'value', jsonb_build_array(jsonb_build_object(
        'content', v_content.draft_copy,
        'image', jsonb_build_array()
      )),
      'settings', v_channel.provider_settings
    ))
  );

  SELECT operation.* INTO v_operation
  FROM tanaghom.external_operations operation
  WHERE operation.provider = 'postiz'
    AND operation.operation_type = 'create_draft'
    AND operation.idempotency_key = v_idempotency_key
  FOR UPDATE;
  IF v_operation.id IS NOT NULL AND v_operation.status IN ('in_progress', 'succeeded', 'indeterminate') THEN
    RAISE EXCEPTION 'Postiz operation cannot be replayed from its current state';
  END IF;

  IF v_operation.id IS NULL THEN
    INSERT INTO tanaghom.external_operations (
      correlation_id, provider, operation_type, idempotency_key, status,
      request_fingerprint, attempt
    ) VALUES (
      v_job.correlation_id, 'postiz', 'create_draft', v_idempotency_key,
      'in_progress', 'md5:' || md5(v_request::text), 1
    ) RETURNING * INTO v_operation;
  ELSE
    UPDATE tanaghom.external_operations
    SET status = 'in_progress', attempt = attempt + 1, response_summary = NULL
    WHERE id = v_operation.id
    RETURNING * INTO v_operation;
  END IF;

  RETURN QUERY SELECT
    v_job.id, v_operation.id, v_content.id, v_content.campaign_id,
    v_content.channel, v_idempotency_key, v_request;
END;
$$;

CREATE FUNCTION tanaghom.complete_postiz_draft(
  p_job_id uuid,
  p_provider_post_id text,
  p_response_summary jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_content_id uuid;
  v_operation tanaghom.external_operations%ROWTYPE;
  v_post_id uuid;
BEGIN
  IF length(trim(coalesce(p_provider_post_id, ''))) = 0
     OR p_response_summary IS NULL OR jsonb_typeof(p_response_summary) <> 'object' THEN
    RAISE EXCEPTION 'valid Postiz response required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'content.postiz.draft' THEN
    RAISE EXCEPTION 'job is not a running Postiz draft job';
  END IF;
  v_content_id := (v_job.input->>'content_item_id')::uuid;
  PERFORM 1 FROM tanaghom.content_items
  WHERE id = v_content_id AND status = 'approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'content is no longer approved'; END IF;

  SELECT operation.* INTO v_operation
  FROM tanaghom.external_operations operation
  WHERE operation.provider = 'postiz'
    AND operation.operation_type = 'create_draft'
    AND operation.idempotency_key = 'postiz-draft:' || v_content_id::text
  FOR UPDATE;
  IF v_operation.id IS NULL OR v_operation.status <> 'in_progress' THEN
    RAISE EXCEPTION 'matching Postiz operation is not in progress';
  END IF;

  INSERT INTO tanaghom.posts (
    content_item_id, provider, provider_post_id, channel, status, last_synced_at
  )
  SELECT v_content_id, 'postiz', trim(p_provider_post_id), content.channel,
         'draft', statement_timestamp()
  FROM tanaghom.content_items content WHERE content.id = v_content_id
  RETURNING id INTO v_post_id;

  UPDATE tanaghom.external_operations
  SET status = 'succeeded', provider_reference = trim(p_provider_post_id),
      response_summary = p_response_summary
  WHERE id = v_operation.id;
  UPDATE tanaghom.agent_jobs
  SET status = 'succeeded', output = jsonb_build_object(
        'contract_version', 'phase4.postiz-draft-result.v1',
        'post_id', v_post_id,
        'provider_post_id', trim(p_provider_post_id)
      ), finished_at = statement_timestamp()
  WHERE id = p_job_id;
  UPDATE tanaghom.agents
  SET status = 'idle', last_heartbeat_at = statement_timestamp()
  WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_job.correlation_id, p_job_id, v_job.agent_id, 'postiz.draft_created',
    'content_item', v_content_id,
    jsonb_build_object('post_id', v_post_id, 'provider_post_id', trim(p_provider_post_id)),
    'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'postiz.draft_created:' || p_job_id::text,
    'postiz.draft_created', 'content_item', v_content_id,
    jsonb_build_object('post_id', v_post_id, 'provider_post_id', trim(p_provider_post_id))
  );
  RETURN v_post_id;
END;
$$;

CREATE FUNCTION tanaghom.record_postiz_draft_failure(
  p_job_id uuid,
  p_error_code text,
  p_error_message text,
  p_http_status integer,
  p_outcome_uncertain boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_content_id uuid;
  v_next_status text;
  v_operation_status text;
BEGIN
  IF length(trim(coalesce(p_error_code, ''))) = 0
     OR length(trim(coalesce(p_error_message, ''))) = 0
     OR p_http_status IS NULL OR p_http_status < 0 OR p_http_status > 599 THEN
    RAISE EXCEPTION 'valid bounded Postiz failure required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'content.postiz.draft' THEN
    RAISE EXCEPTION 'job is not a running Postiz draft job';
  END IF;
  v_content_id := (v_job.input->>'content_item_id')::uuid;
  v_next_status := CASE
    WHEN NOT p_outcome_uncertain AND p_http_status = 429 AND v_job.attempt < v_job.max_attempts THEN 'queued'
    ELSE 'failed'
  END;
  v_operation_status := CASE WHEN p_outcome_uncertain THEN 'indeterminate' ELSE 'failed' END;

  UPDATE tanaghom.external_operations
  SET status = v_operation_status,
      response_summary = jsonb_build_object(
        'error_code', left(trim(p_error_code), 120),
        'http_status', p_http_status,
        'outcome_uncertain', p_outcome_uncertain
      )
  WHERE provider = 'postiz' AND operation_type = 'create_draft'
    AND idempotency_key = 'postiz-draft:' || v_content_id::text
    AND status = 'in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'matching Postiz operation is not in progress'; END IF;

  UPDATE tanaghom.agent_jobs
  SET status = v_next_status,
      error_code = left(trim(p_error_code), 120),
      error_message = left(trim(p_error_message), 4000),
      available_at = CASE WHEN v_next_status = 'queued'
        THEN statement_timestamp() + interval '1 hour' ELSE available_at END,
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
    v_job.correlation_id, p_job_id, v_job.agent_id,
    CASE WHEN p_outcome_uncertain THEN 'postiz.draft_indeterminate' ELSE 'postiz.draft_failed' END,
    'content_item', v_content_id,
    jsonb_build_object(
      'error_code', left(trim(p_error_code), 120),
      'http_status', p_http_status,
      'outcome_uncertain', p_outcome_uncertain,
      'next_status', v_next_status
    ), 'failed'
  );
  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION tanaghom.queue_postiz_draft(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.prepare_postiz_draft(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.complete_postiz_draft(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_postiz_draft_failure(uuid, text, text, integer, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION tanaghom.queue_postiz_draft(uuid, uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.prepare_postiz_draft(uuid) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.complete_postiz_draft(uuid, text, jsonb) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.record_postiz_draft_failure(uuid, text, text, integer, boolean) TO tanaghom_n8n_worker;
GRANT SELECT ON tanaghom.publishing_channels TO tanaghom_api, tanaghom_readonly;

INSERT INTO public.schema_migrations(version)
VALUES ('0007_postiz_draft_handoff');

COMMIT;
