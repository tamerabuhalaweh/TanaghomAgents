BEGIN;

-- Durable, deduplicated alert deliveries for configured email/Slack destinations.
-- Nothing is enqueued or claimed unless the existing platform control is runtime_ready AND NOT emergency_stop.
CREATE TABLE tanaghom.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES tanaghom.notification_destinations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'queue_age','interactive_backlog','dependency_cooldown','worker_unready',
    'dead_letter','indeterminate_action','database_unavailable')),
  severity text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 8 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_status integer CHECK (provider_status IS NULL OR provider_status BETWEEN 100 AND 599),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{3,64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (destination_id, dedupe_key),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

CREATE INDEX notification_deliveries_due_idx ON tanaghom.notification_deliveries (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX notification_deliveries_recent_idx ON tanaghom.notification_deliveries (destination_id, created_at);

CREATE TRIGGER notification_deliveries_set_updated_at
BEFORE UPDATE ON tanaghom.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE FUNCTION tanaghom.notification_delivery_active()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(bool_and(runtime_ready AND NOT emergency_stop), false)
  FROM tanaghom.notification_delivery_controls
$$;

-- One delivery per destination, event type and UTC hour; at most 10 new deliveries per destination per hour.
CREATE FUNCTION tanaghom.enqueue_notification_deliveries()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_inserted integer;
BEGIN
  IF NOT tanaghom.notification_delivery_active() THEN RETURN 0; END IF;
  WITH events AS (
    SELECT capacity.organization_id, event.event_type, event.severity
    FROM tanaghom.conversation_capacity_status capacity
    CROSS JOIN LATERAL (VALUES
      ('queue_age', 'warning', coalesce(capacity.oldest_queue_age_seconds >= capacity.queue_age_warning_seconds, false)),
      ('interactive_backlog', 'warning', coalesce(capacity.interactive_depth >= capacity.interactive_backlog_threshold, false)),
      ('dependency_cooldown', 'warning', coalesce(capacity.gemma_blocked_until > statement_timestamp(), false)
        OR coalesce(capacity.ghl_blocked_until > statement_timestamp(), false)),
      ('dead_letter', 'error', coalesce(capacity.dead_letter_count > 0, false)),
      ('indeterminate_action', 'critical', coalesce(capacity.indeterminate_actions > 0, false))
    ) AS event(event_type, severity, active)
    WHERE event.active
  ), candidates AS (
    SELECT destination.id AS destination_id, destination.organization_id, events.event_type, events.severity
    FROM events
    JOIN tanaghom.notification_destinations destination ON destination.organization_id = events.organization_id
    WHERE destination.status = 'configured'
      AND destination.channel IN ('email', 'slack')
      AND events.event_type = ANY(destination.event_types)
      AND array_position(ARRAY['info','warning','error','critical'], events.severity)
        >= array_position(ARRAY['info','warning','error','critical'], destination.minimum_severity)
      AND (SELECT count(*) FROM tanaghom.notification_deliveries recent
           WHERE recent.destination_id = destination.id
             AND recent.created_at > statement_timestamp() - interval '1 hour') < 10
  )
  INSERT INTO tanaghom.notification_deliveries (organization_id, destination_id, event_type, severity, dedupe_key)
  SELECT organization_id, destination_id, event_type, severity,
    event_type || ':' || to_char(date_trunc('hour', statement_timestamp() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24')
  FROM candidates
  ON CONFLICT (destination_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- A claim older than 5 minutes has an unknown outcome: it is failed, never resent, to avoid duplicates.
CREATE FUNCTION tanaghom.claim_notification_deliveries(p_limit integer)
RETURNS TABLE (
  delivery_id uuid, channel text, event_type text, severity text, attempts integer,
  organization_name text, target_ciphertext bytea, target_nonce bytea,
  target_auth_tag bytea, target_key_version integer
) LANGUAGE plpgsql AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN RAISE EXCEPTION 'claim limit must be between 1 and 50'; END IF;
  UPDATE tanaghom.notification_deliveries
     SET status = 'failed', last_error_code = 'outcome_unknown'
   WHERE status = 'sending' AND claimed_at < statement_timestamp() - interval '5 minutes';
  IF NOT tanaghom.notification_delivery_active() THEN RETURN; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT delivery.id FROM tanaghom.notification_deliveries delivery
    JOIN tanaghom.notification_destinations destination ON destination.id = delivery.destination_id
    WHERE delivery.status = 'pending' AND delivery.next_attempt_at <= statement_timestamp()
      AND destination.status = 'configured'
    ORDER BY delivery.next_attempt_at, delivery.id
    LIMIT p_limit
    FOR UPDATE OF delivery SKIP LOCKED
  ), claimed AS (
    UPDATE tanaghom.notification_deliveries delivery
       SET status = 'sending', attempts = delivery.attempts + 1, claimed_at = statement_timestamp()
      FROM due WHERE delivery.id = due.id
    RETURNING delivery.*
  )
  SELECT claimed.id, destination.channel, claimed.event_type, claimed.severity, claimed.attempts,
         organization.name, destination.target_ciphertext, destination.target_nonce,
         destination.target_auth_tag, destination.target_key_version
  FROM claimed
  JOIN tanaghom.notification_destinations destination ON destination.id = claimed.destination_id
  JOIN tanaghom.organizations organization ON organization.id = claimed.organization_id;
END;
$$;

CREATE FUNCTION tanaghom.complete_notification_delivery(
  p_delivery_id uuid, p_sent boolean, p_provider_status integer, p_error_code text, p_retryable boolean
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_delivery tanaghom.notification_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_delivery FROM tanaghom.notification_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF v_delivery.id IS NULL OR v_delivery.status <> 'sending' THEN
    RAISE EXCEPTION 'notification delivery is not in progress';
  END IF;
  IF p_sent THEN
    UPDATE tanaghom.notification_deliveries
       SET status = 'sent', sent_at = statement_timestamp(), provider_status = p_provider_status, last_error_code = NULL
     WHERE id = p_delivery_id;
    RETURN 'sent';
  END IF;
  IF p_retryable AND v_delivery.attempts < 5 THEN
    UPDATE tanaghom.notification_deliveries
       SET status = 'pending', provider_status = p_provider_status, last_error_code = p_error_code,
           next_attempt_at = statement_timestamp() + make_interval(mins => power(2, v_delivery.attempts)::integer)
     WHERE id = p_delivery_id;
    RETURN 'pending';
  END IF;
  UPDATE tanaghom.notification_deliveries
     SET status = 'failed', provider_status = p_provider_status, last_error_code = p_error_code
   WHERE id = p_delivery_id;
  RETURN 'failed';
END;
$$;

REVOKE ALL ON tanaghom.notification_deliveries
FROM PUBLIC, tanaghom_readonly, tanaghom_n8n_worker, tanaghom_conversation_worker;
GRANT SELECT ON tanaghom.notification_deliveries TO tanaghom_api;
REVOKE ALL ON FUNCTION tanaghom.notification_delivery_active(), tanaghom.enqueue_notification_deliveries(),
  tanaghom.claim_notification_deliveries(integer),
  tanaghom.complete_notification_delivery(uuid, boolean, integer, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.notification_delivery_active(), tanaghom.enqueue_notification_deliveries(),
  tanaghom.claim_notification_deliveries(integer),
  tanaghom.complete_notification_delivery(uuid, boolean, integer, text, boolean) TO tanaghom_api;
GRANT INSERT, UPDATE ON tanaghom.notification_deliveries TO tanaghom_api;

INSERT INTO public.schema_migrations(version) VALUES ('0036_notification_delivery_worker');

COMMIT;
