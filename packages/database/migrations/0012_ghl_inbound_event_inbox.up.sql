BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tanaghom_conversation_worker') THEN
    RAISE EXCEPTION 'package role tanaghom_conversation_worker already exists';
  END IF;
  CREATE ROLE tanaghom_conversation_worker
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
END;
$$;

GRANT USAGE ON SCHEMA tanaghom TO tanaghom_conversation_worker;

ALTER TABLE tanaghom.organization_crm_policies
  ADD COLUMN conversation_processing_mode text NOT NULL DEFAULT 'paused'
    CHECK (conversation_processing_mode IN ('paused', 'shadow'));

CREATE TABLE tanaghom.ghl_webhook_rejection_metrics (
  bucket_minute timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'ingress_disabled', 'payload_too_large', 'content_type_invalid',
    'signature_missing', 'signature_invalid', 'invalid_json',
    'unsupported_event', 'invalid_event', 'location_unconfigured'
  )),
  rejection_count bigint NOT NULL DEFAULT 1 CHECK (rejection_count > 0),
  last_body_sha256 text CHECK (last_body_sha256 IS NULL OR last_body_sha256 ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_minute, reason)
);

CREATE TABLE tanaghom.ghl_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  integration_connection_id uuid NOT NULL REFERENCES tanaghom.integration_connections(id) ON DELETE RESTRICT,
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 3 AND 300),
  provider_event_type text NOT NULL CHECK (provider_event_type IN (
    'InboundMessage', 'OutboundMessage', 'ContactCreate', 'ContactUpdate',
    'ContactDndUpdate', 'ConversationUnreadWebhook'
  )),
  location_id text NOT NULL CHECK (location_id ~ '^[A-Za-z0-9_-]{3,100}$'),
  contact_id text CHECK (contact_id IS NULL OR length(contact_id) BETWEEN 1 AND 300),
  conversation_id text CHECK (conversation_id IS NULL OR length(conversation_id) BETWEEN 1 AND 300),
  message_id text CHECK (message_id IS NULL OR length(message_id) BETWEEN 1 AND 300),
  channel text NOT NULL CHECK (channel IN (
    'whatsapp', 'instagram', 'facebook', 'sms', 'email', 'live_chat',
    'gmb', 'call', 'voicemail', 'system', 'unknown'
  )),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  occurred_at timestamptz NOT NULL,
  contract_version text NOT NULL CHECK (contract_version = 'phase5.ghl-inbound-event.v1'),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'dead_letter')),
  delivery_count integer NOT NULL DEFAULT 1 CHECK (delivery_count > 0),
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  last_error_code text,
  last_error_message text,
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_replayed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_connection_id, provider_event_id)
);

CREATE TRIGGER ghl_inbound_events_updated_at
BEFORE UPDATE ON tanaghom.ghl_inbound_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE INDEX ghl_inbound_events_claim_idx
  ON tanaghom.ghl_inbound_events(status, first_received_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX ghl_inbound_events_organization_time_idx
  ON tanaghom.ghl_inbound_events(organization_id, first_received_at DESC);
CREATE INDEX ghl_inbound_events_conversation_idx
  ON tanaghom.ghl_inbound_events(organization_id, conversation_id, occurred_at)
  WHERE conversation_id IS NOT NULL;
CREATE UNIQUE INDEX agent_jobs_ghl_inbound_event_uidx
  ON tanaghom.agent_jobs ((input->>'event_id'))
  WHERE job_type = 'conversation.ghl.inbound_event';

CREATE VIEW tanaghom.ghl_inbound_event_metrics AS
SELECT
  organization_id,
  count(*) FILTER (WHERE status = 'pending')::bigint AS queue_depth,
  count(*) FILTER (WHERE status = 'processing')::bigint AS processing_count,
  count(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded_count,
  count(*) FILTER (WHERE status = 'dead_letter')::bigint AS dead_letter_count,
  coalesce(sum(greatest(delivery_count - 1, 0)), 0)::bigint AS duplicate_delivery_count,
  coalesce(sum(replay_count), 0)::bigint AS replay_count,
  coalesce(extract(epoch FROM statement_timestamp() - min(first_received_at)
    FILTER (WHERE status = 'pending')), 0)::bigint AS oldest_queue_age_seconds,
  max(last_received_at) AS last_received_at
FROM tanaghom.ghl_inbound_events
GROUP BY organization_id;

CREATE FUNCTION tanaghom.record_ghl_webhook_rejection(
  p_reason text,
  p_body_sha256 text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_bucket timestamptz := date_trunc('minute', statement_timestamp());
BEGIN
  IF coalesce(p_reason, '') NOT IN (
    'ingress_disabled', 'payload_too_large', 'content_type_invalid',
    'signature_missing', 'signature_invalid', 'invalid_json',
    'unsupported_event', 'invalid_event', 'location_unconfigured'
  ) OR (p_body_sha256 IS NOT NULL AND p_body_sha256 !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid GHL webhook rejection metric';
  END IF;

  INSERT INTO tanaghom.ghl_webhook_rejection_metrics (
    bucket_minute, reason, rejection_count, last_body_sha256, last_seen_at
  ) VALUES (
    v_bucket, p_reason, 1, p_body_sha256, statement_timestamp()
  )
  ON CONFLICT (bucket_minute, reason) DO UPDATE SET
    rejection_count = tanaghom.ghl_webhook_rejection_metrics.rejection_count + 1,
    last_body_sha256 = EXCLUDED.last_body_sha256,
    last_seen_at = statement_timestamp();
END;
$$;

CREATE FUNCTION tanaghom.accept_ghl_inbound_event(
  p_event jsonb,
  p_body_sha256 text
)
RETURNS TABLE (
  event_id uuid,
  organization_id uuid,
  event_status text,
  duplicate boolean,
  delivery_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_connection_count integer;
  v_connection_id uuid;
  v_organization_id uuid;
  v_agent_id uuid;
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
  v_occurred_at timestamptz;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object'
     OR p_event->>'contract_version' <> 'phase5.ghl-inbound-event.v1'
     OR coalesce(p_body_sha256, '') !~ '^[0-9a-f]{64}$'
     OR octet_length(p_event::text) > 131072
     OR length(coalesce(p_event->>'provider_event_id', '')) NOT BETWEEN 3 AND 300
     OR coalesce(p_event->>'provider_event_type', '') NOT IN (
       'InboundMessage', 'OutboundMessage', 'ContactCreate', 'ContactUpdate',
       'ContactDndUpdate', 'ConversationUnreadWebhook'
     )
     OR coalesce(p_event->>'location_id', '') !~ '^[A-Za-z0-9_-]{3,100}$'
     OR coalesce(p_event->>'channel', '') NOT IN (
       'whatsapp', 'instagram', 'facebook', 'sms', 'email', 'live_chat',
       'gmb', 'call', 'voicemail', 'system', 'unknown'
     )
     OR coalesce(p_event->>'direction', '') NOT IN ('inbound', 'outbound', 'system')
     OR coalesce(jsonb_typeof(p_event->'details'), '') <> 'object'
     OR length(coalesce(p_event->'details'->>'body', '')) > 32768
     OR length(coalesce(p_event->>'contact_id', '')) > 300
     OR length(coalesce(p_event->>'conversation_id', '')) > 300
     OR length(coalesce(p_event->>'message_id', '')) > 300 THEN
    RAISE EXCEPTION 'invalid_ghl_inbound_event_contract';
  END IF;

  BEGIN
    v_occurred_at := (p_event->>'occurred_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_ghl_inbound_event_contract';
  END;

  SELECT count(*)::integer, (array_agg(connection.id))[1],
         (array_agg(connection.organization_id))[1]
    INTO v_connection_count, v_connection_id, v_organization_id
    FROM tanaghom.integration_connections connection
   WHERE connection.provider = 'ghl'
     AND connection.status = 'connected'
     AND connection.configuration->>'location_id' = p_event->>'location_id';
  IF v_connection_count <> 1 THEN
    RAISE EXCEPTION 'ghl_inbound_location_not_configured';
  END IF;

  SELECT id INTO v_agent_id
    FROM tanaghom.agents
   WHERE code = 'sales_crm' AND status <> 'disabled';
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'sales_crm_unavailable';
  END IF;

  INSERT INTO tanaghom.ghl_inbound_events (
    correlation_id, organization_id, integration_connection_id,
    provider_event_id, provider_event_type, location_id,
    contact_id, conversation_id, message_id, channel, direction,
    occurred_at, contract_version, body_sha256, payload
  ) VALUES (
    v_correlation_id, v_organization_id, v_connection_id,
    p_event->>'provider_event_id', p_event->>'provider_event_type', p_event->>'location_id',
    nullif(p_event->>'contact_id', ''), nullif(p_event->>'conversation_id', ''),
    nullif(p_event->>'message_id', ''), p_event->>'channel', p_event->>'direction',
    v_occurred_at, p_event->>'contract_version', p_body_sha256, p_event
  )
  ON CONFLICT (integration_connection_id, provider_event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF v_event.id IS NULL THEN
    UPDATE tanaghom.ghl_inbound_events existing SET
      delivery_count = existing.delivery_count + 1,
      last_received_at = statement_timestamp()
    WHERE existing.integration_connection_id = v_connection_id
      AND existing.provider_event_id = p_event->>'provider_event_id'
    RETURNING * INTO v_event;

    INSERT INTO tanaghom.agent_actions_log (
      correlation_id, agent_id, action_type, entity_type, entity_id, payload, result
    ) VALUES (
      v_event.correlation_id, v_agent_id, 'ghl.inbound_event_duplicate',
      'ghl_inbound_event', v_event.id,
      jsonb_build_object(
        'provider_event_type', v_event.provider_event_type,
        'delivery_count', v_event.delivery_count,
        'body_sha256', p_body_sha256
      ), 'skipped_duplicate'
    );
    RETURN QUERY SELECT v_event.id, v_event.organization_id, v_event.status, true, v_event.delivery_count;
    RETURN;
  END IF;

  INSERT INTO tanaghom.agent_jobs (
    correlation_id, agent_id, campaign_id, job_type, max_attempts, input
  ) VALUES (
    v_event.correlation_id, v_agent_id, NULL, 'conversation.ghl.inbound_event', 5,
    jsonb_build_object(
      'contract_version', 'phase5.ghl-inbound-event-job.v1',
      'event_id', v_event.id,
      'organization_id', v_event.organization_id,
      'provider_event_type', v_event.provider_event_type
    )
  );

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_event.correlation_id, v_agent_id, 'ghl.inbound_event_accepted',
    'ghl_inbound_event', v_event.id,
    jsonb_build_object(
      'organization_id', v_event.organization_id,
      'provider_event_type', v_event.provider_event_type,
      'channel', v_event.channel,
      'body_sha256', p_body_sha256
    ), 'success'
  );

  RETURN QUERY SELECT v_event.id, v_event.organization_id, v_event.status, false, v_event.delivery_count;
END;
$$;

CREATE FUNCTION tanaghom.claim_ghl_inbound_event_job()
RETURNS TABLE (
  job_id uuid,
  event_id uuid,
  correlation_id uuid,
  organization_id uuid,
  provider_event_type text,
  attempt integer,
  max_attempts integer,
  event_payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_job_id uuid;
BEGIN
  SELECT candidate.id INTO v_job_id
    FROM tanaghom.agent_jobs candidate
    JOIN tanaghom.ghl_inbound_events event
      ON event.id = (candidate.input->>'event_id')::uuid
    JOIN tanaghom.agents agent ON agent.id = candidate.agent_id
    JOIN tanaghom.integration_connections connection
      ON connection.id = event.integration_connection_id
     AND connection.organization_id = event.organization_id
     AND connection.provider = 'ghl' AND connection.status = 'connected'
    JOIN tanaghom.organization_crm_policies policy
      ON policy.organization_id = event.organization_id
     AND policy.conversation_processing_mode = 'shadow'
    JOIN tanaghom.automation_platform_controls control
      ON control.provider = 'ghl' AND NOT control.emergency_stop
   WHERE candidate.job_type = 'conversation.ghl.inbound_event'
     AND candidate.status = 'queued'
     AND candidate.available_at <= statement_timestamp()
     AND candidate.attempt < candidate.max_attempts
     AND candidate.input->>'contract_version' = 'phase5.ghl-inbound-event-job.v1'
     AND candidate.input->>'organization_id' = event.organization_id::text
     AND event.status = 'pending'
     AND agent.code = 'sales_crm' AND agent.status <> 'disabled'
   ORDER BY candidate.available_at, candidate.created_at
   FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;

  IF v_job_id IS NULL THEN RETURN; END IF;

  UPDATE tanaghom.agent_jobs job SET
    status = 'running', attempt = job.attempt + 1,
    started_at = statement_timestamp(), finished_at = NULL,
    error_code = NULL, error_message = NULL
  WHERE id = v_job_id;

  UPDATE tanaghom.ghl_inbound_events event SET
    status = 'processing', claimed_at = statement_timestamp(),
    processed_at = NULL, last_error_code = NULL, last_error_message = NULL
  FROM tanaghom.agent_jobs job
  WHERE job.id = v_job_id AND event.id = (job.input->>'event_id')::uuid;

  UPDATE tanaghom.agents agent SET
    status = 'working', last_heartbeat_at = statement_timestamp()
  FROM tanaghom.agent_jobs job
  WHERE job.id = v_job_id AND agent.id = job.agent_id;

  RETURN QUERY
  SELECT job.id, event.id, job.correlation_id, event.organization_id,
         event.provider_event_type, job.attempt, job.max_attempts, event.payload
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.ghl_inbound_events event ON event.id = (job.input->>'event_id')::uuid
   WHERE job.id = v_job_id;
END;
$$;

CREATE FUNCTION tanaghom.complete_ghl_inbound_event(
  p_job_id uuid,
  p_result jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
     OR p_result->>'contract_version' <> 'phase5.ghl-inbound-event-result.v1'
     OR coalesce(p_result->>'outcome', '') NOT IN ('accepted_for_conversation_intelligence', 'ignored_without_action')
     OR coalesce(p_result->>'external_action_count', '') <> '0'
     OR length(coalesce(p_result->>'notes', '')) > 500 THEN
    RAISE EXCEPTION 'invalid GHL inbound event result contract';
  END IF;

  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'conversation.ghl.inbound_event' THEN
    RAISE EXCEPTION 'job is not a running GHL inbound event job';
  END IF;

  SELECT * INTO v_event FROM tanaghom.ghl_inbound_events
   WHERE id = (v_job.input->>'event_id')::uuid FOR UPDATE;
  IF v_event.id IS NULL OR v_event.status <> 'processing'
     OR p_result->>'event_id' <> v_event.id::text THEN
    RAISE EXCEPTION 'GHL inbound result does not match the claimed event';
  END IF;

  UPDATE tanaghom.ghl_inbound_events SET
    status = 'succeeded', processed_at = statement_timestamp(),
    last_error_code = NULL, last_error_message = NULL
  WHERE id = v_event.id;
  UPDATE tanaghom.agent_jobs SET
    status = 'succeeded', output = p_result, finished_at = statement_timestamp()
  WHERE id = v_job.id;
  UPDATE tanaghom.agents SET status = 'idle', last_heartbeat_at = statement_timestamp()
  WHERE id = v_job.agent_id;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_job.agent_id,
    'ghl.inbound_event_processed_without_action', 'ghl_inbound_event', v_event.id,
    jsonb_build_object('outcome', p_result->>'outcome', 'external_action_count', 0), 'success'
  );
  RETURN 'succeeded';
END;
$$;

CREATE FUNCTION tanaghom.record_ghl_inbound_event_failure(
  p_job_id uuid,
  p_error_code text,
  p_error_message text,
  p_retry_after_seconds integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
  v_next_job_status text;
  v_next_event_status text;
BEGIN
  IF length(trim(coalesce(p_error_code, ''))) NOT BETWEEN 1 AND 120
     OR length(trim(coalesce(p_error_message, ''))) NOT BETWEEN 1 AND 4000
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'valid bounded GHL inbound failure required';
  END IF;

  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'conversation.ghl.inbound_event' THEN
    RAISE EXCEPTION 'job is not a running GHL inbound event job';
  END IF;
  SELECT * INTO v_event FROM tanaghom.ghl_inbound_events
   WHERE id = (v_job.input->>'event_id')::uuid FOR UPDATE;
  IF v_event.id IS NULL OR v_event.status <> 'processing' THEN
    RAISE EXCEPTION 'matching GHL inbound event is not processing';
  END IF;

  v_next_job_status := CASE WHEN v_job.attempt < v_job.max_attempts THEN 'queued' ELSE 'failed' END;
  v_next_event_status := CASE WHEN v_next_job_status = 'queued' THEN 'pending' ELSE 'dead_letter' END;

  UPDATE tanaghom.agent_jobs SET
    status = v_next_job_status,
    error_code = left(trim(p_error_code), 120),
    error_message = left(trim(p_error_message), 4000),
    available_at = CASE WHEN v_next_job_status = 'queued'
      THEN statement_timestamp() + make_interval(secs => p_retry_after_seconds) ELSE available_at END,
    finished_at = CASE WHEN v_next_job_status = 'failed' THEN statement_timestamp() ELSE NULL END
  WHERE id = v_job.id;
  UPDATE tanaghom.ghl_inbound_events SET
    status = v_next_event_status,
    last_error_code = left(trim(p_error_code), 120),
    last_error_message = left(trim(p_error_message), 1000),
    processed_at = CASE WHEN v_next_event_status = 'dead_letter' THEN statement_timestamp() ELSE NULL END
  WHERE id = v_event.id;
  UPDATE tanaghom.agents SET
    status = CASE WHEN v_next_job_status = 'queued' THEN 'idle' ELSE 'failed' END,
    last_heartbeat_at = statement_timestamp()
  WHERE id = v_job.agent_id;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_job.agent_id, 'ghl.inbound_event_failed',
    'ghl_inbound_event', v_event.id,
    jsonb_build_object(
      'error_code', left(trim(p_error_code), 120),
      'next_job_status', v_next_job_status,
      'next_event_status', v_next_event_status
    ), 'failed'
  );

  IF v_next_event_status = 'dead_letter' THEN
    INSERT INTO tanaghom.notifications (user_id, severity, title, body, entity_type, entity_id)
    SELECT app.id, 'error', 'GHL conversation event needs review',
      'An authenticated conversation event exhausted bounded processing retries and entered the dead-letter queue.',
      'ghl_inbound_event', v_event.id
    FROM tanaghom.app_users app
    WHERE app.organization_id = v_event.organization_id
      AND app.role = 'owner' AND app.is_active AND app.accepted_at IS NOT NULL;
  END IF;
  RETURN v_next_event_status;
END;
$$;

CREATE FUNCTION tanaghom.recover_stale_ghl_inbound_event_jobs(
  p_stale_after_seconds integer DEFAULT 300
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job record;
  v_recovered integer := 0;
BEGIN
  IF p_stale_after_seconds IS NULL OR p_stale_after_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'stale recovery window must be between 60 and 3600 seconds';
  END IF;

  FOR v_job IN
    SELECT job.id, job.agent_id, (job.input->>'event_id')::uuid AS event_id
      FROM tanaghom.agent_jobs job
      JOIN tanaghom.ghl_inbound_events event ON event.id = (job.input->>'event_id')::uuid
     WHERE job.job_type = 'conversation.ghl.inbound_event'
       AND job.status = 'running' AND event.status = 'processing'
       AND job.started_at <= statement_timestamp() - make_interval(secs => p_stale_after_seconds)
     FOR UPDATE OF job SKIP LOCKED
  LOOP
    UPDATE tanaghom.agent_jobs SET
      status = 'queued', available_at = statement_timestamp(),
      error_code = 'worker_lease_expired',
      error_message = 'Conversation worker stopped before acknowledging the claimed event.',
      finished_at = NULL
    WHERE id = v_job.id;
    UPDATE tanaghom.ghl_inbound_events SET
      status = 'pending', claimed_at = NULL,
      last_error_code = 'worker_lease_expired',
      last_error_message = 'Conversation worker stopped before acknowledging the claimed event.'
    WHERE id = v_job.event_id;
    UPDATE tanaghom.agents SET status = 'idle', last_heartbeat_at = statement_timestamp()
    WHERE id = v_job.agent_id;
    v_recovered := v_recovered + 1;
  END LOOP;
  RETURN v_recovered;
END;
$$;

CREATE FUNCTION tanaghom.replay_ghl_inbound_event(
  p_event_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (event_id uuid, job_id uuid, event_status text, replay_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
  v_job tanaghom.agent_jobs%ROWTYPE;
BEGIN
  SELECT event.* INTO v_event
    FROM tanaghom.ghl_inbound_events event
    JOIN tanaghom.app_users actor
      ON actor.organization_id = event.organization_id
     AND actor.id = p_actor_user_id
     AND actor.kind = 'human' AND actor.role IN ('owner', 'operator')
     AND actor.is_active AND actor.accepted_at IS NOT NULL
   WHERE event.id = p_event_id
   FOR UPDATE OF event;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'active CRM operator and organization event required'; END IF;
  IF v_event.status <> 'dead_letter' THEN RAISE EXCEPTION 'only dead-letter GHL events can be replayed'; END IF;

  SELECT * INTO v_job FROM tanaghom.agent_jobs
   WHERE job_type = 'conversation.ghl.inbound_event'
     AND input->>'event_id' = v_event.id::text FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'failed' THEN
    RAISE EXCEPTION 'dead-letter event does not have one failed job';
  END IF;

  UPDATE tanaghom.agent_jobs SET
    status = 'queued', attempt = 0, available_at = statement_timestamp(),
    started_at = NULL, finished_at = NULL, output = NULL,
    error_code = NULL, error_message = NULL
  WHERE id = v_job.id;
  UPDATE tanaghom.ghl_inbound_events event SET
    status = 'pending', replay_count = event.replay_count + 1,
    last_replayed_at = statement_timestamp(), claimed_at = NULL, processed_at = NULL,
    last_error_code = NULL, last_error_message = NULL
  WHERE id = v_event.id RETURNING * INTO v_event;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_event.correlation_id, v_job.id, p_actor_user_id, 'ghl.inbound_event_replayed',
    'ghl_inbound_event', v_event.id,
    jsonb_build_object('replay_count', v_event.replay_count), 'success'
  );
  RETURN QUERY SELECT v_event.id, v_job.id, v_event.status, v_event.replay_count;
END;
$$;

REVOKE ALL ON tanaghom.ghl_webhook_rejection_metrics FROM PUBLIC, tanaghom_api, tanaghom_n8n_worker, tanaghom_readonly, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.ghl_inbound_events FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.ghl_inbound_event_metrics FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_webhook_rejection(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.accept_ghl_inbound_event(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_ghl_inbound_event_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.complete_ghl_inbound_event(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_inbound_event_failure(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.recover_stale_ghl_inbound_event_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.replay_ghl_inbound_event(uuid, uuid) FROM PUBLIC;

GRANT SELECT ON tanaghom.ghl_inbound_events TO tanaghom_api;
GRANT SELECT ON tanaghom.ghl_inbound_event_metrics TO tanaghom_api, tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.record_ghl_webhook_rejection(text, text) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.accept_ghl_inbound_event(jsonb, text) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.replay_ghl_inbound_event(uuid, uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_inbound_event_job() TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.complete_ghl_inbound_event(uuid, jsonb) TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.record_ghl_inbound_event_failure(uuid, text, text, integer) TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.recover_stale_ghl_inbound_event_jobs(integer) TO tanaghom_conversation_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0012_ghl_inbound_event_inbox');

COMMIT;
