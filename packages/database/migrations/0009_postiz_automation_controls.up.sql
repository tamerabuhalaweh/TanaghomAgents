BEGIN;

CREATE TABLE tanaghom.organization_automation_policies (
  organization_id uuid PRIMARY KEY REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  postiz_draft_mode text NOT NULL DEFAULT 'manual'
    CHECK (postiz_draft_mode IN ('manual', 'automatic', 'paused')),
  changed_by uuid REFERENCES tanaghom.app_users(id),
  changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tanaghom.automation_platform_controls (
  provider text PRIMARY KEY CHECK (provider = 'postiz'),
  emergency_stop boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT 'Awaiting controlled worker activation'
    CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tanaghom.automation_platform_controls (provider)
VALUES ('postiz');

INSERT INTO tanaghom.organization_automation_policies (organization_id)
SELECT id FROM tanaghom.organizations;

CREATE TRIGGER organization_automation_policies_updated_at
BEFORE UPDATE ON tanaghom.organization_automation_policies
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE TRIGGER automation_platform_controls_updated_at
BEFORE UPDATE ON tanaghom.automation_platform_controls
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE FUNCTION tanaghom.create_organization_automation_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO tanaghom.organization_automation_policies (organization_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_create_automation_policy
AFTER INSERT ON tanaghom.organizations
FOR EACH ROW EXECUTE FUNCTION tanaghom.create_organization_automation_policy();

CREATE VIEW tanaghom.postiz_automation_status AS
SELECT
  policy.organization_id,
  policy.postiz_draft_mode,
  policy.changed_by,
  policy.changed_at,
  policy.updated_at,
  control.emergency_stop,
  control.reason AS emergency_stop_reason,
  EXISTS (
    SELECT 1
    FROM tanaghom.integration_connections connection
    WHERE connection.organization_id = policy.organization_id
      AND connection.provider = 'postiz'
      AND connection.status = 'connected'
  ) AS connection_ready,
  EXISTS (
    SELECT 1
    FROM tanaghom.publishing_channels mapping
    WHERE mapping.organization_id = policy.organization_id
      AND mapping.provider = 'postiz'
      AND mapping.is_active
  ) AS channel_mapping_ready,
  NOT EXISTS (
    SELECT 1
    FROM tanaghom.external_operations operation
    JOIN tanaghom.agent_jobs job ON job.correlation_id = operation.correlation_id
    JOIN tanaghom.campaigns campaign ON campaign.id = job.campaign_id
    WHERE campaign.organization_id = policy.organization_id
      AND operation.provider = 'postiz'
      AND operation.status = 'indeterminate'
  ) AS operations_clear
FROM tanaghom.organization_automation_policies policy
CROSS JOIN tanaghom.automation_platform_controls control
WHERE control.provider = 'postiz';

CREATE FUNCTION tanaghom.set_postiz_automation_mode(
  p_actor_user_id uuid,
  p_mode text,
  p_runtime_ready boolean
)
RETURNS TABLE (
  postiz_draft_mode text,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
  v_previous_mode text;
  v_connection_ready boolean;
  v_mapping_ready boolean;
  v_operations_clear boolean;
  v_emergency_stop boolean;
  v_changed_at timestamptz;
BEGIN
  IF p_mode NOT IN ('manual', 'automatic', 'paused') THEN
    RAISE EXCEPTION 'valid Postiz automation mode required';
  END IF;

  SELECT actor.organization_id INTO v_organization_id
  FROM tanaghom.app_users actor
  WHERE actor.id = p_actor_user_id
    AND actor.kind = 'human'
    AND actor.role = 'owner'
    AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'active owner required'; END IF;

  SELECT status.postiz_draft_mode, status.connection_ready,
         status.channel_mapping_ready, status.operations_clear,
         status.emergency_stop
  INTO v_previous_mode, v_connection_ready, v_mapping_ready,
       v_operations_clear, v_emergency_stop
  FROM tanaghom.postiz_automation_status status
  WHERE status.organization_id = v_organization_id
  FOR SHARE;
  IF v_previous_mode IS NULL THEN RAISE EXCEPTION 'automation policy not found'; END IF;

  IF p_mode = 'automatic' THEN
    IF NOT coalesce(p_runtime_ready, false) THEN
      RAISE EXCEPTION 'Postiz automation runtime is not ready';
    END IF;
    IF v_emergency_stop THEN RAISE EXCEPTION 'Postiz automation emergency stop is active'; END IF;
    IF NOT v_connection_ready THEN RAISE EXCEPTION 'connected Postiz integration required'; END IF;
    IF NOT v_mapping_ready THEN RAISE EXCEPTION 'active Postiz channel mapping required'; END IF;
    IF NOT v_operations_clear THEN RAISE EXCEPTION 'indeterminate Postiz operation requires review'; END IF;
  END IF;

  IF v_previous_mode = p_mode THEN
    SELECT policy.changed_at INTO v_changed_at
    FROM tanaghom.organization_automation_policies policy
    WHERE policy.organization_id = v_organization_id;
    RETURN QUERY SELECT p_mode, v_changed_at;
    RETURN;
  END IF;

  UPDATE tanaghom.organization_automation_policies policy
  SET postiz_draft_mode = p_mode,
      changed_by = p_actor_user_id,
      changed_at = statement_timestamp()
  WHERE policy.organization_id = v_organization_id
  RETURNING policy.changed_at INTO v_changed_at;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    gen_random_uuid(), p_actor_user_id, 'postiz.automation_mode_changed',
    'organization', v_organization_id,
    jsonb_build_object(
      'previous_mode', v_previous_mode,
      'new_mode', p_mode,
      'runtime_ready', coalesce(p_runtime_ready, false),
      'connection_ready', v_connection_ready,
      'channel_mapping_ready', v_mapping_ready,
      'operations_clear', v_operations_clear,
      'emergency_stop', v_emergency_stop
    ), 'success'
  );

  RETURN QUERY SELECT p_mode, v_changed_at;
END;
$$;

CREATE FUNCTION tanaghom.enforce_postiz_automation_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
  v_mode text;
  v_emergency_stop boolean;
BEGIN
  IF TG_TABLE_NAME = 'agent_jobs' THEN
    IF NEW.job_type <> 'content.postiz.draft' THEN RETURN NEW; END IF;
    SELECT campaign.organization_id INTO v_organization_id
    FROM tanaghom.campaigns campaign WHERE campaign.id = NEW.campaign_id;
  ELSE
    IF NEW.provider <> 'postiz' OR NEW.operation_type <> 'create_draft'
       OR NEW.status <> 'in_progress' THEN RETURN NEW; END IF;
    SELECT campaign.organization_id INTO v_organization_id
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id = job.campaign_id
    WHERE job.correlation_id = NEW.correlation_id;
  END IF;

  SELECT policy.postiz_draft_mode, control.emergency_stop
  INTO v_mode, v_emergency_stop
  FROM tanaghom.organization_automation_policies policy
  CROSS JOIN tanaghom.automation_platform_controls control
  WHERE policy.organization_id = v_organization_id
    AND control.provider = 'postiz';

  IF v_organization_id IS NULL OR v_mode IS NULL THEN
    RAISE EXCEPTION 'Postiz automation policy required';
  END IF;
  IF v_emergency_stop THEN RAISE EXCEPTION 'Postiz automation emergency stop is active'; END IF;
  IF v_mode = 'paused' THEN RAISE EXCEPTION 'Postiz draft automation is paused'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.integration_connections connection
    WHERE connection.organization_id = v_organization_id
      AND connection.provider = 'postiz' AND connection.status = 'connected'
  ) THEN RAISE EXCEPTION 'connected Postiz integration required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.publishing_channels mapping
    WHERE mapping.organization_id = v_organization_id
      AND mapping.provider = 'postiz' AND mapping.is_active
  ) THEN RAISE EXCEPTION 'active Postiz channel mapping required'; END IF;
  IF EXISTS (
    SELECT 1
    FROM tanaghom.external_operations operation
    JOIN tanaghom.agent_jobs job ON job.correlation_id = operation.correlation_id
    JOIN tanaghom.campaigns campaign ON campaign.id = job.campaign_id
    WHERE campaign.organization_id = v_organization_id
      AND operation.provider = 'postiz'
      AND operation.status = 'indeterminate'
  ) THEN RAISE EXCEPTION 'indeterminate Postiz operation requires review'; END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_jobs_postiz_automation_gate
BEFORE INSERT ON tanaghom.agent_jobs
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_postiz_automation_gate();

CREATE TRIGGER external_operations_postiz_automation_gate
BEFORE INSERT OR UPDATE OF status ON tanaghom.external_operations
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_postiz_automation_gate();

CREATE FUNCTION tanaghom.maybe_queue_automatic_postiz_draft(
  p_content_item_id uuid,
  p_actor_user_id uuid,
  p_runtime_ready boolean
)
RETURNS TABLE (
  queued boolean,
  reason text,
  job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
  v_mode text;
  v_status tanaghom.postiz_automation_status%ROWTYPE;
  v_job record;
BEGIN
  SELECT actor.organization_id INTO v_organization_id
  FROM tanaghom.app_users actor
  WHERE actor.id = p_actor_user_id
    AND actor.kind = 'human'
    AND actor.role IN ('owner', 'reviewer')
    AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'active reviewer required'; END IF;

  SELECT status.* INTO v_status
  FROM tanaghom.postiz_automation_status status
  WHERE status.organization_id = v_organization_id;
  v_mode := v_status.postiz_draft_mode;

  IF v_mode <> 'automatic' THEN
    RETURN QUERY SELECT false, CASE WHEN v_mode = 'paused' THEN 'paused' ELSE 'manual_required' END, NULL::uuid;
    RETURN;
  END IF;
  IF NOT coalesce(p_runtime_ready, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_ready'::text, NULL::uuid; RETURN;
  END IF;
  IF v_status.emergency_stop THEN
    RETURN QUERY SELECT false, 'emergency_stopped'::text, NULL::uuid; RETURN;
  END IF;
  IF NOT v_status.connection_ready THEN
    RETURN QUERY SELECT false, 'connection_not_ready'::text, NULL::uuid; RETURN;
  END IF;
  IF NOT v_status.channel_mapping_ready THEN
    RETURN QUERY SELECT false, 'channel_mapping_not_ready'::text, NULL::uuid; RETURN;
  END IF;
  IF NOT v_status.operations_clear THEN
    RETURN QUERY SELECT false, 'indeterminate_operation'::text, NULL::uuid; RETURN;
  END IF;

  SELECT queued_job.* INTO v_job
  FROM tanaghom.queue_postiz_draft(p_content_item_id, p_actor_user_id) queued_job;
  RETURN QUERY SELECT true, 'queued'::text, v_job.job_id::uuid;
END;
$$;

CREATE FUNCTION tanaghom.claim_postiz_draft_job()
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
  SELECT candidate.id INTO v_job_id
  FROM tanaghom.agent_jobs candidate
  JOIN tanaghom.agents agent ON agent.id = candidate.agent_id
  JOIN tanaghom.campaigns campaign ON campaign.id = candidate.campaign_id
  JOIN tanaghom.organization_automation_policies policy
    ON policy.organization_id = campaign.organization_id
   AND policy.postiz_draft_mode IN ('manual', 'automatic')
  JOIN tanaghom.automation_platform_controls control
    ON control.provider = 'postiz' AND NOT control.emergency_stop
  JOIN tanaghom.integration_connections connection
    ON connection.organization_id = campaign.organization_id
   AND connection.provider = 'postiz' AND connection.status = 'connected'
  WHERE agent.code = 'publisher_monitor'
    AND agent.status <> 'disabled'
    AND candidate.job_type = 'content.postiz.draft'
    AND candidate.status = 'queued'
    AND candidate.available_at <= statement_timestamp()
    AND candidate.attempt < candidate.max_attempts
    AND candidate.input->>'organization_id' = campaign.organization_id::text
    AND EXISTS (
      SELECT 1
      FROM tanaghom.content_items content
      JOIN tanaghom.publishing_channels mapping
        ON mapping.organization_id = campaign.organization_id
       AND mapping.provider = 'postiz'
       AND mapping.channel = content.channel
       AND mapping.is_active
      WHERE content.id::text = candidate.input->>'content_item_id'
        AND content.campaign_id = campaign.id
        AND content.status = 'approved'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM tanaghom.external_operations operation
      JOIN tanaghom.agent_jobs related_job ON related_job.correlation_id = operation.correlation_id
      JOIN tanaghom.campaigns related_campaign ON related_campaign.id = related_job.campaign_id
      WHERE related_campaign.organization_id = campaign.organization_id
        AND operation.provider = 'postiz'
        AND operation.status = 'indeterminate'
    )
  ORDER BY candidate.available_at, candidate.created_at
  FOR UPDATE OF candidate SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NULL THEN RETURN; END IF;

  UPDATE tanaghom.agent_jobs job
  SET status = 'running', attempt = job.attempt + 1,
      started_at = statement_timestamp(), finished_at = NULL,
      error_code = NULL, error_message = NULL
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

REVOKE ALL ON tanaghom.organization_automation_policies FROM PUBLIC, tanaghom_api, tanaghom_readonly, tanaghom_n8n_worker;
REVOKE ALL ON tanaghom.automation_platform_controls FROM PUBLIC, tanaghom_api, tanaghom_readonly, tanaghom_n8n_worker;
REVOKE ALL ON FUNCTION tanaghom.create_organization_automation_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.enforce_postiz_automation_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.set_postiz_automation_mode(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.maybe_queue_automatic_postiz_draft(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_postiz_draft_job() FROM PUBLIC;

GRANT SELECT ON tanaghom.postiz_automation_status TO tanaghom_api, tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.set_postiz_automation_mode(uuid, text, boolean) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.maybe_queue_automatic_postiz_draft(uuid, uuid, boolean) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_postiz_draft_job() TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0009_postiz_automation_controls');

COMMIT;
