BEGIN;

CREATE TABLE tanaghom.post_metric_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES tanaghom.posts(id) ON DELETE CASCADE,
  sync_job_id uuid REFERENCES tanaghom.agent_jobs(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider = 'postiz'),
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  metric_label text NOT NULL CHECK (length(trim(metric_label)) BETWEEN 1 AND 160),
  observed_on date NOT NULL,
  metric_value numeric(20,4) NOT NULL CHECK (metric_value >= 0),
  percentage_change numeric(12,4),
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_metadata) = 'object'),
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, post_id, provider, metric_key, observed_on)
);

CREATE TABLE tanaghom.post_performance_sync_state (
  post_id uuid PRIMARY KEY REFERENCES tanaghom.posts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'queued', 'running', 'succeeded', 'failed')),
  provider_cursor text,
  lookback_days integer NOT NULL DEFAULT 30 CHECK (lookback_days BETWEEN 1 AND 90),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message text,
  stale_after timestamptz,
  last_result_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(last_result_summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, post_id)
);

CREATE TABLE tanaghom.lead_attribution_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('postiz', 'manual', 'webhook')),
  provider_event_id text NOT NULL CHECK (length(trim(provider_event_id)) BETWEEN 1 AND 240),
  payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('attributed', 'quarantined')),
  lead_id uuid REFERENCES tanaghom.leads(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES tanaghom.campaigns(id) ON DELETE SET NULL,
  source_post_id uuid REFERENCES tanaghom.posts(id) ON DELETE SET NULL,
  quarantine_reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, provider_event_id),
  CHECK (
    (status = 'attributed'
      AND lead_id IS NOT NULL AND campaign_id IS NOT NULL AND source_post_id IS NOT NULL
      AND quarantine_reason IS NULL)
    OR
    (status = 'quarantined'
      AND lead_id IS NULL AND campaign_id IS NULL AND source_post_id IS NULL
      AND length(trim(coalesce(quarantine_reason, ''))) BETWEEN 3 AND 500)
  )
);

CREATE INDEX post_metric_observations_report_idx
  ON tanaghom.post_metric_observations(organization_id, observed_on DESC, metric_key);
CREATE INDEX post_performance_sync_due_idx
  ON tanaghom.post_performance_sync_state(organization_id, stale_after)
  WHERE status IN ('succeeded', 'failed');
CREATE INDEX lead_attribution_quarantine_idx
  ON tanaghom.lead_attribution_records(organization_id, received_at DESC)
  WHERE status = 'quarantined';
CREATE UNIQUE INDEX agent_jobs_postiz_performance_active_uidx
  ON tanaghom.agent_jobs ((input->>'post_id'))
  WHERE job_type = 'postiz.performance.sync' AND status IN ('queued', 'running');

CREATE TRIGGER post_performance_sync_state_updated_at
BEFORE UPDATE ON tanaghom.post_performance_sync_state
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE FUNCTION tanaghom.enforce_phase4h_organization_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_post_organization_id uuid;
  v_post_campaign_id uuid;
  v_lead_organization_id uuid;
  v_lead_campaign_id uuid;
BEGIN
  IF TG_TABLE_NAME IN ('post_metric_observations', 'post_performance_sync_state') THEN
    SELECT campaign.organization_id, campaign.id
      INTO v_post_organization_id, v_post_campaign_id
      FROM tanaghom.posts post
      JOIN tanaghom.content_items content ON content.id = post.content_item_id
      JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
     WHERE post.id = NEW.post_id;
    IF v_post_organization_id IS NULL OR v_post_organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'post does not belong to the supplied organization';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'attributed' THEN
    SELECT campaign.organization_id, lead.campaign_id
      INTO v_lead_organization_id, v_lead_campaign_id
      FROM tanaghom.leads lead
      JOIN tanaghom.campaigns campaign ON campaign.id = lead.campaign_id
     WHERE lead.id = NEW.lead_id;
    SELECT campaign.organization_id, campaign.id
      INTO v_post_organization_id, v_post_campaign_id
      FROM tanaghom.posts post
      JOIN tanaghom.content_items content ON content.id = post.content_item_id
      JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
     WHERE post.id = NEW.source_post_id;
    IF v_lead_organization_id IS NULL OR v_post_organization_id IS NULL
       OR v_lead_organization_id <> NEW.organization_id
       OR v_post_organization_id <> NEW.organization_id
       OR v_lead_campaign_id <> NEW.campaign_id
       OR v_post_campaign_id <> NEW.campaign_id THEN
      RAISE EXCEPTION 'attribution evidence crosses an organization or campaign boundary';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER post_metric_observation_organization_guard
BEFORE INSERT OR UPDATE ON tanaghom.post_metric_observations
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_phase4h_organization_links();
CREATE TRIGGER post_performance_sync_organization_guard
BEFORE INSERT OR UPDATE ON tanaghom.post_performance_sync_state
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_phase4h_organization_links();
CREATE TRIGGER lead_attribution_organization_guard
BEFORE INSERT OR UPDATE ON tanaghom.lead_attribution_records
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_phase4h_organization_links();

CREATE FUNCTION tanaghom.queue_postiz_performance_sync(
  p_post_id uuid,
  p_actor_user_id uuid,
  p_lookback_days integer DEFAULT 30
)
RETURNS TABLE (job_id uuid, correlation_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
  v_campaign_id uuid;
  v_agent_id uuid;
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF p_lookback_days IS NULL OR p_lookback_days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'performance lookback must be between 1 and 90 days';
  END IF;
  SELECT actor.organization_id INTO v_organization_id
    FROM tanaghom.app_users actor
   WHERE actor.id = p_actor_user_id AND actor.kind = 'human'
     AND actor.role IN ('owner', 'operator') AND actor.is_active
     AND actor.accepted_at IS NOT NULL;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'active performance operator required'; END IF;

  SELECT campaign.id INTO v_campaign_id
    FROM tanaghom.posts post
    JOIN tanaghom.content_items content ON content.id = post.content_item_id
    JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
   WHERE post.id = p_post_id AND post.provider = 'postiz' AND post.status = 'live'
     AND campaign.organization_id = v_organization_id
   FOR UPDATE OF post;
  IF v_campaign_id IS NULL THEN RAISE EXCEPTION 'live Postiz post not found in organization'; END IF;

  PERFORM 1
    FROM tanaghom.integration_connections connection
    JOIN tanaghom.organization_automation_policies policy
      ON policy.organization_id = connection.organization_id
    JOIN tanaghom.automation_platform_controls control ON control.provider = 'postiz'
   WHERE connection.organization_id = v_organization_id
     AND connection.provider = 'postiz' AND connection.status = 'connected'
     AND policy.postiz_draft_mode IN ('manual', 'automatic')
     AND NOT control.emergency_stop;
  IF NOT FOUND THEN RAISE EXCEPTION 'Postiz performance synchronization is not ready'; END IF;

  PERFORM 1
    FROM tanaghom.external_operations operation
    JOIN tanaghom.agent_jobs related_job ON related_job.correlation_id = operation.correlation_id
    JOIN tanaghom.campaigns related_campaign ON related_campaign.id = related_job.campaign_id
   WHERE related_campaign.organization_id = v_organization_id
     AND operation.provider = 'postiz' AND operation.status = 'indeterminate';
  IF FOUND THEN RAISE EXCEPTION 'indeterminate Postiz operation requires human review'; END IF;

  SELECT job.* INTO v_job
    FROM tanaghom.agent_jobs job
   WHERE job.job_type = 'postiz.performance.sync'
     AND job.input->>'post_id' = p_post_id::text
     AND job.status IN ('queued', 'running')
   ORDER BY job.created_at DESC LIMIT 1;
  IF v_job.id IS NOT NULL THEN
    RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
    RETURN;
  END IF;

  SELECT id INTO v_agent_id FROM tanaghom.agents
   WHERE code = 'publisher_monitor' AND status <> 'disabled';
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'publisher monitor is unavailable'; END IF;

  INSERT INTO tanaghom.agent_jobs (
    correlation_id, agent_id, campaign_id, job_type, max_attempts, input
  ) VALUES (
    v_correlation_id, v_agent_id, v_campaign_id, 'postiz.performance.sync', 5,
    jsonb_build_object(
      'contract_version', 'phase4.postiz-performance-job.v1',
      'organization_id', v_organization_id,
      'post_id', p_post_id,
      'lookback_days', p_lookback_days,
      'requested_by', p_actor_user_id
    )
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.post_performance_sync_state (
    post_id, organization_id, status, lookback_days
  ) VALUES (p_post_id, v_organization_id, 'queued', p_lookback_days)
  ON CONFLICT (post_id) DO UPDATE SET
    status = 'queued', lookback_days = EXCLUDED.lookback_days,
    last_error_code = NULL, last_error_message = NULL;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type,
    entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, p_actor_user_id,
    'postiz.performance_sync_requested', 'post', p_post_id,
    jsonb_build_object('lookback_days', p_lookback_days, 'organization_id', v_organization_id),
    'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'postiz.performance_sync_requested:' || v_job.id::text,
    'postiz.performance_sync_requested', 'post', p_post_id,
    jsonb_build_object('job_id', v_job.id, 'post_id', p_post_id)
  );
  RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
END;
$$;

CREATE FUNCTION tanaghom.claim_postiz_performance_job()
RETURNS TABLE (
  job_id uuid, correlation_id uuid, campaign_id uuid, job_type text,
  attempt integer, max_attempts integer, input jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_job_id uuid;
BEGIN
  SELECT candidate.id INTO v_job_id
    FROM tanaghom.agent_jobs candidate
    JOIN tanaghom.agents agent ON agent.id = candidate.agent_id
    JOIN tanaghom.posts post ON post.id = (candidate.input->>'post_id')::uuid
    JOIN tanaghom.content_items content ON content.id = post.content_item_id
    JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
    JOIN tanaghom.integration_connections connection
      ON connection.organization_id = campaign.organization_id
     AND connection.provider = 'postiz' AND connection.status = 'connected'
    JOIN tanaghom.organization_automation_policies policy
      ON policy.organization_id = campaign.organization_id
     AND policy.postiz_draft_mode IN ('manual', 'automatic')
    JOIN tanaghom.automation_platform_controls control
      ON control.provider = 'postiz' AND NOT control.emergency_stop
   WHERE candidate.job_type = 'postiz.performance.sync'
     AND candidate.status = 'queued' AND candidate.available_at <= statement_timestamp()
     AND candidate.attempt < candidate.max_attempts
     AND candidate.input->>'contract_version' = 'phase4.postiz-performance-job.v1'
     AND candidate.input->>'organization_id' = campaign.organization_id::text
     AND candidate.campaign_id = campaign.id
     AND post.provider = 'postiz' AND post.status = 'live'
     AND agent.code = 'publisher_monitor' AND agent.status <> 'disabled'
     AND NOT EXISTS (
       SELECT 1 FROM tanaghom.external_operations operation
       JOIN tanaghom.agent_jobs related_job ON related_job.correlation_id = operation.correlation_id
       JOIN tanaghom.campaigns related_campaign ON related_campaign.id = related_job.campaign_id
       WHERE related_campaign.organization_id = campaign.organization_id
         AND operation.provider = 'postiz' AND operation.status = 'indeterminate'
     )
   ORDER BY candidate.available_at, candidate.created_at
   FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;
  IF v_job_id IS NULL THEN RETURN; END IF;

  UPDATE tanaghom.agent_jobs job SET status = 'running', attempt = job.attempt + 1,
    started_at = statement_timestamp(), finished_at = NULL,
    error_code = NULL, error_message = NULL WHERE job.id = v_job_id;
  UPDATE tanaghom.post_performance_sync_state state SET
    status = 'running', last_attempt_at = statement_timestamp()
    FROM tanaghom.agent_jobs job
    WHERE job.id = v_job_id AND state.post_id = (job.input->>'post_id')::uuid;
  UPDATE tanaghom.agents agent SET status = 'working', last_heartbeat_at = statement_timestamp()
    FROM tanaghom.agent_jobs job WHERE job.id = v_job_id AND agent.id = job.agent_id;
  RETURN QUERY SELECT job.id, job.correlation_id, job.campaign_id, job.job_type,
    job.attempt, job.max_attempts, job.input FROM tanaghom.agent_jobs job WHERE job.id = v_job_id;
END;
$$;

CREATE FUNCTION tanaghom.prepare_postiz_performance_sync(p_job_id uuid)
RETURNS TABLE (
  job_id uuid, operation_id uuid, post_id uuid, organization_id uuid,
  idempotency_key text, request_body jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_post tanaghom.posts%ROWTYPE;
  v_organization_id uuid;
  v_operation tanaghom.external_operations%ROWTYPE;
  v_request jsonb;
  v_key text;
BEGIN
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  SELECT post.* INTO v_post FROM tanaghom.posts post
   WHERE post.id = (v_job.input->>'post_id')::uuid FOR SHARE;
  SELECT campaign.organization_id INTO v_organization_id
    FROM tanaghom.content_items content
    JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
   WHERE content.id = v_post.content_item_id AND campaign.id = v_job.campaign_id;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'postiz.performance.sync'
     OR v_job.input->>'contract_version' <> 'phase4.postiz-performance-job.v1'
     OR v_post.id IS NULL OR v_post.provider <> 'postiz' OR v_post.status <> 'live'
     OR v_job.input->>'organization_id' <> v_organization_id::text THEN
    RAISE EXCEPTION 'job is not a running Postiz performance job';
  END IF;

  v_key := 'postiz-analytics:' || v_job.id::text || ':' || v_job.attempt::text;
  v_request := jsonb_build_object(
    'provider_post_id', v_post.provider_post_id,
    'date', (v_job.input->>'lookback_days')::integer
  );
  INSERT INTO tanaghom.external_operations (
    correlation_id, provider, operation_type, idempotency_key, status,
    request_fingerprint, attempt
  ) VALUES (
    v_job.correlation_id, 'postiz', 'read_analytics', v_key, 'in_progress',
    'md5:' || md5(v_request::text), v_job.attempt
  ) RETURNING * INTO v_operation;
  RETURN QUERY SELECT v_job.id, v_operation.id, v_post.id, v_organization_id, v_key, v_request;
END;
$$;

CREATE FUNCTION tanaghom.complete_postiz_performance_sync(p_job_id uuid, p_result jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_post_id uuid;
  v_organization_id uuid;
  v_metric jsonb;
  v_count integer := 0;
  v_impressions bigint;
  v_clicks bigint;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
     OR p_result->>'contract_version' <> 'phase4.postiz-performance-result.v1'
     OR jsonb_typeof(p_result->'metrics') <> 'array'
     OR jsonb_array_length(p_result->'metrics') > 5000 THEN
    RAISE EXCEPTION 'invalid Postiz performance result contract';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running' OR v_job.job_type <> 'postiz.performance.sync' THEN
    RAISE EXCEPTION 'job is not a running Postiz performance job';
  END IF;
  v_post_id := (v_job.input->>'post_id')::uuid;
  v_organization_id := (v_job.input->>'organization_id')::uuid;
  PERFORM 1 FROM tanaghom.external_operations
   WHERE correlation_id = v_job.correlation_id AND provider = 'postiz'
     AND operation_type = 'read_analytics' AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'matching Postiz analytics operation is not in progress'; END IF;

  FOR v_metric IN SELECT value FROM jsonb_array_elements(p_result->'metrics') LOOP
    IF jsonb_typeof(v_metric) <> 'object'
       OR coalesce(v_metric->>'metric_key', '') !~ '^[a-z][a-z0-9_]{0,79}$'
       OR length(trim(coalesce(v_metric->>'metric_label', ''))) NOT BETWEEN 1 AND 160
       OR coalesce(v_metric->>'observed_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR coalesce(v_metric->>'value', '') !~ '^\d+(?:\.\d{1,4})?$'
       OR (v_metric->>'observed_on')::date > current_date + 1 THEN
      RAISE EXCEPTION 'invalid normalized Postiz metric';
    END IF;
    INSERT INTO tanaghom.post_metric_observations (
      organization_id, post_id, sync_job_id, provider, metric_key, metric_label,
      observed_on, metric_value, percentage_change, provider_metadata
    ) VALUES (
      v_organization_id, v_post_id, v_job.id, 'postiz', v_metric->>'metric_key',
      trim(v_metric->>'metric_label'), (v_metric->>'observed_on')::date,
      (v_metric->>'value')::numeric,
      CASE WHEN coalesce(v_metric->>'percentage_change', '') ~ '^-?\d+(?:\.\d{1,4})?$'
        THEN (v_metric->>'percentage_change')::numeric ELSE NULL END,
      coalesce(v_metric->'provider_metadata', '{}'::jsonb)
    ) ON CONFLICT (organization_id, post_id, provider, metric_key, observed_on)
      DO UPDATE SET metric_value = EXCLUDED.metric_value,
        metric_label = EXCLUDED.metric_label,
        percentage_change = EXCLUDED.percentage_change,
        provider_metadata = EXCLUDED.provider_metadata,
        sync_job_id = EXCLUDED.sync_job_id,
        synced_at = statement_timestamp();
    v_count := v_count + 1;
  END LOOP;

  SELECT metric_value::bigint INTO v_impressions
    FROM tanaghom.post_metric_observations
   WHERE post_id = v_post_id AND metric_key = 'impressions'
   ORDER BY observed_on DESC LIMIT 1;
  SELECT metric_value::bigint INTO v_clicks
    FROM tanaghom.post_metric_observations
   WHERE post_id = v_post_id AND metric_key = 'clicks'
   ORDER BY observed_on DESC LIMIT 1;
  UPDATE tanaghom.posts SET impressions = coalesce(v_impressions, impressions),
    clicks = coalesce(v_clicks, clicks), last_synced_at = statement_timestamp()
   WHERE id = v_post_id;
  UPDATE tanaghom.post_performance_sync_state SET status = 'succeeded',
    consecutive_failures = 0, last_success_at = statement_timestamp(),
    last_error_code = NULL, last_error_message = NULL,
    stale_after = statement_timestamp() + interval '25 hours',
    last_result_summary = jsonb_build_object('metric_points', v_count)
   WHERE post_id = v_post_id;
  UPDATE tanaghom.external_operations SET status = 'succeeded',
    response_summary = jsonb_build_object('metric_points', v_count)
   WHERE correlation_id = v_job.correlation_id AND provider = 'postiz'
     AND operation_type = 'read_analytics' AND status = 'in_progress';
  UPDATE tanaghom.agent_jobs SET status = 'succeeded', output = jsonb_build_object(
    'contract_version', 'phase4.postiz-performance-result.v1', 'metric_points', v_count
  ), finished_at = statement_timestamp() WHERE id = v_job.id;
  UPDATE tanaghom.agents SET status = 'idle', last_heartbeat_at = statement_timestamp()
   WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_job.agent_id, 'postiz.performance_synced',
    'post', v_post_id, jsonb_build_object('metric_points', v_count), 'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'postiz.performance_synced:' || v_job.id::text,
    'postiz.performance_synced', 'post', v_post_id,
    jsonb_build_object('job_id', v_job.id, 'metric_points', v_count)
  );
  RETURN v_count;
END;
$$;

CREATE FUNCTION tanaghom.record_postiz_performance_failure(
  p_job_id uuid,
  p_error_code text,
  p_error_message text,
  p_http_status integer,
  p_retry_after_seconds integer DEFAULT 300
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_post_id uuid;
  v_next_status text;
BEGIN
  IF length(trim(coalesce(p_error_code, ''))) = 0
     OR length(trim(coalesce(p_error_message, ''))) = 0
     OR p_http_status IS NULL OR p_http_status NOT BETWEEN 0 AND 599
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'valid bounded performance failure required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running' OR v_job.job_type <> 'postiz.performance.sync' THEN
    RAISE EXCEPTION 'job is not a running Postiz performance job';
  END IF;
  v_post_id := (v_job.input->>'post_id')::uuid;
  v_next_status := CASE
    WHEN (p_http_status = 0 OR p_http_status IN (408, 429) OR p_http_status >= 500)
      AND v_job.attempt < v_job.max_attempts THEN 'queued'
    ELSE 'failed' END;
  UPDATE tanaghom.external_operations SET status = 'failed', response_summary = jsonb_build_object(
    'error_code', left(trim(p_error_code), 120), 'http_status', p_http_status
  ) WHERE correlation_id = v_job.correlation_id AND provider = 'postiz'
    AND operation_type = 'read_analytics' AND status = 'in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'matching Postiz analytics operation is not in progress'; END IF;
  UPDATE tanaghom.agent_jobs SET status = v_next_status,
    error_code = left(trim(p_error_code), 120), error_message = left(trim(p_error_message), 4000),
    available_at = CASE WHEN v_next_status = 'queued'
      THEN statement_timestamp() + make_interval(secs => p_retry_after_seconds) ELSE available_at END,
    finished_at = CASE WHEN v_next_status = 'failed' THEN statement_timestamp() ELSE NULL END
   WHERE id = v_job.id;
  UPDATE tanaghom.post_performance_sync_state SET status = v_next_status,
    consecutive_failures = consecutive_failures + 1,
    last_error_code = left(trim(p_error_code), 120),
    last_error_message = left(trim(p_error_message), 1000),
    stale_after = coalesce(stale_after, statement_timestamp())
   WHERE post_id = v_post_id;
  UPDATE tanaghom.agents SET status = CASE WHEN v_next_status = 'queued' THEN 'idle' ELSE 'failed' END,
    last_heartbeat_at = statement_timestamp() WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_job.agent_id, 'postiz.performance_sync_failed',
    'post', v_post_id, jsonb_build_object('error_code', left(trim(p_error_code), 120),
      'http_status', p_http_status, 'next_status', v_next_status), 'failed'
  );
  IF v_next_status = 'failed' THEN
    INSERT INTO tanaghom.notifications (user_id, severity, title, body, entity_type, entity_id)
    SELECT app.id, 'error', 'Postiz performance sync failed',
      'Performance data could not be refreshed after bounded retries. Review the provider connection and job evidence.',
      'post', v_post_id
    FROM tanaghom.app_users app
    WHERE app.organization_id = (v_job.input->>'organization_id')::uuid
      AND app.role = 'owner' AND app.is_active AND app.accepted_at IS NOT NULL;
  END IF;
  RETURN v_next_status;
END;
$$;

REVOKE ALL ON tanaghom.post_metric_observations FROM PUBLIC, tanaghom_n8n_worker;
REVOKE ALL ON tanaghom.post_performance_sync_state FROM PUBLIC, tanaghom_n8n_worker;
REVOKE ALL ON tanaghom.lead_attribution_records FROM PUBLIC, tanaghom_n8n_worker;
REVOKE ALL ON FUNCTION tanaghom.enforce_phase4h_organization_links() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.queue_postiz_performance_sync(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_postiz_performance_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.prepare_postiz_performance_sync(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.complete_postiz_performance_sync(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_postiz_performance_failure(uuid, text, text, integer, integer) FROM PUBLIC;

GRANT SELECT ON tanaghom.post_metric_observations, tanaghom.post_performance_sync_state,
  tanaghom.lead_attribution_records TO tanaghom_api, tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.queue_postiz_performance_sync(uuid, uuid, integer) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_postiz_performance_job() TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.prepare_postiz_performance_sync(uuid) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.complete_postiz_performance_sync(uuid, jsonb) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.record_postiz_performance_failure(uuid, text, text, integer, integer) TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0010_postiz_performance_monitoring');

COMMIT;
