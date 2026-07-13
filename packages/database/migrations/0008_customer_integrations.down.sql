BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tanaghom.integration_connections
    WHERE status <> 'disconnected'
  ) THEN
    RAISE EXCEPTION 'disconnect customer integrations before rolling back 0008';
  END IF;
  IF (SELECT count(*) FROM tanaghom.organizations) <> 1 THEN
    RAISE EXCEPTION 'cannot roll back 0008 after creating additional organizations';
  END IF;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON tanaghom.publishing_channels FROM tanaghom_api;
REVOKE INSERT (organization_id) ON tanaghom.app_users FROM tanaghom_api;
DROP VIEW tanaghom.integration_connection_status;
DROP TABLE tanaghom.integration_connections;

-- Restore the organization-agnostic Phase 4C publishing functions before the
-- organization columns disappear. This keeps a standalone 0008 rollback usable
-- without requiring an immediate rollback of 0007.
CREATE OR REPLACE FUNCTION tanaghom.queue_postiz_draft(
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

CREATE OR REPLACE FUNCTION tanaghom.prepare_postiz_draft(p_job_id uuid)
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

DROP INDEX tanaghom.publishing_channels_organization_idx;
DROP INDEX tanaghom.campaigns_organization_idx;
DROP INDEX tanaghom.app_users_organization_idx;

ALTER TABLE tanaghom.publishing_channels
  DROP CONSTRAINT publishing_channels_workspace_channel_key,
  DROP CONSTRAINT publishing_channels_workspace_integration_key,
  ADD CONSTRAINT publishing_channels_provider_channel_key UNIQUE (provider, channel),
  ADD CONSTRAINT publishing_channels_provider_provider_integration_id_key
    UNIQUE (provider, provider_integration_id),
  DROP COLUMN organization_id;
ALTER TABLE tanaghom.campaigns DROP COLUMN organization_id;
ALTER TABLE tanaghom.app_users DROP COLUMN organization_id;
DROP TABLE tanaghom.organizations;

DELETE FROM public.schema_migrations
WHERE version = '0008_customer_integrations';

COMMIT;
