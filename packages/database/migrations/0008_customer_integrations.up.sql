BEGIN;

CREATE TABLE tanaghom.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tanaghom.organizations (id, slug, name)
VALUES ('10000000-0000-4000-8000-000000000001', 'tanaghom', 'Tanaghom Workspace');

ALTER TABLE tanaghom.app_users
  ADD COLUMN organization_id uuid DEFAULT '10000000-0000-4000-8000-000000000001'
    REFERENCES tanaghom.organizations(id);
UPDATE tanaghom.app_users
SET organization_id = '10000000-0000-4000-8000-000000000001';
ALTER TABLE tanaghom.app_users ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE tanaghom.campaigns
  ADD COLUMN organization_id uuid DEFAULT '10000000-0000-4000-8000-000000000001'
    REFERENCES tanaghom.organizations(id);
UPDATE tanaghom.campaigns
SET organization_id = '10000000-0000-4000-8000-000000000001';
ALTER TABLE tanaghom.campaigns ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE tanaghom.publishing_channels
  ADD COLUMN organization_id uuid DEFAULT '10000000-0000-4000-8000-000000000001'
    REFERENCES tanaghom.organizations(id);
UPDATE tanaghom.publishing_channels
SET organization_id = '10000000-0000-4000-8000-000000000001';
ALTER TABLE tanaghom.publishing_channels ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE tanaghom.publishing_channels
  DROP CONSTRAINT publishing_channels_provider_channel_key,
  DROP CONSTRAINT publishing_channels_provider_provider_integration_id_key,
  ADD CONSTRAINT publishing_channels_workspace_channel_key
    UNIQUE (organization_id, provider, channel),
  ADD CONSTRAINT publishing_channels_workspace_integration_key
    UNIQUE (organization_id, provider, provider_integration_id);

CREATE TABLE tanaghom.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('postiz', 'ghl')),
  status text NOT NULL DEFAULT 'configured'
    CHECK (status IN ('configured', 'connected', 'error', 'disconnected')),
  base_url text NOT NULL CHECK (length(trim(base_url)) BETWEEN 12 AND 500),
  credential_kind text NOT NULL CHECK (credential_kind IN ('api_key', 'private_token', 'oauth')),
  credential_ciphertext bytea,
  credential_nonce bytea,
  credential_auth_tag bytea,
  credential_key_version integer,
  secret_last_four text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  configured_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  last_tested_at timestamptz,
  last_test_status text CHECK (last_test_status IS NULL OR last_test_status IN ('passed', 'failed')),
  last_error_code text,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider),
  CHECK (
    (status = 'disconnected'
      AND credential_ciphertext IS NULL
      AND credential_nonce IS NULL
      AND credential_auth_tag IS NULL
      AND credential_key_version IS NULL
      AND secret_last_four IS NULL
      AND disconnected_at IS NOT NULL)
    OR
    (status <> 'disconnected'
      AND octet_length(credential_ciphertext) > 0
      AND octet_length(credential_nonce) = 12
      AND octet_length(credential_auth_tag) = 16
      AND credential_key_version > 0
      AND length(secret_last_four) = 4
      AND disconnected_at IS NULL)
  )
);

CREATE TRIGGER organizations_updated_at
BEFORE UPDATE ON tanaghom.organizations
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER integration_connections_updated_at
BEFORE UPDATE ON tanaghom.integration_connections
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE INDEX app_users_organization_idx
  ON tanaghom.app_users(organization_id, kind, is_active);
CREATE INDEX campaigns_organization_idx
  ON tanaghom.campaigns(organization_id, status);
CREATE INDEX publishing_channels_organization_idx
  ON tanaghom.publishing_channels(organization_id, provider, is_active);

CREATE VIEW tanaghom.integration_connection_status AS
SELECT
  id, organization_id, provider, status, base_url, credential_kind,
  secret_last_four, configuration, configured_by, last_tested_at,
  last_test_status, last_error_code, disconnected_at, created_at, updated_at
FROM tanaghom.integration_connections;

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
  v_organization_id uuid;
  v_campaign_id uuid;
  v_status text;
  v_agent_id uuid;
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT actor.organization_id INTO v_organization_id
  FROM tanaghom.app_users actor
  WHERE actor.id = p_actor_user_id
    AND actor.kind = 'human'
    AND actor.role IN ('owner', 'reviewer', 'operator')
    AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'active publishing operator required'; END IF;

  SELECT content.campaign_id, content.status
  INTO v_campaign_id, v_status
  FROM tanaghom.content_items content
  JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
  WHERE content.id = p_content_item_id
    AND campaign.organization_id = v_organization_id
  FOR UPDATE OF content;
  IF v_campaign_id IS NULL THEN RAISE EXCEPTION 'content item not found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'approved content required'; END IF;

  PERFORM 1
  FROM tanaghom.content_approvals approval
  JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
  WHERE approval.content_item_id = p_content_item_id
    AND approval.decision = 'approved'
    AND reviewer.organization_id = v_organization_id
    AND reviewer.kind = 'human'
    AND reviewer.role IN ('owner', 'reviewer')
    AND reviewer.is_active
    AND reviewer.accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'active human approval evidence required'; END IF;

  PERFORM 1
  FROM tanaghom.content_items content
  JOIN tanaghom.publishing_channels mapping
    ON mapping.organization_id = v_organization_id
   AND mapping.provider = 'postiz'
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
      'requested_by', p_actor_user_id,
      'organization_id', v_organization_id
    )
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type,
    entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, p_actor_user_id,
    'postiz.draft_requested', 'content_item', p_content_item_id,
    jsonb_build_object('job_id', v_job.id, 'campaign_id', v_campaign_id, 'organization_id', v_organization_id),
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
  v_organization_id uuid;
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

  SELECT content.*
  INTO v_content
  FROM tanaghom.content_items content
  JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
  WHERE content.id = (v_job.input->>'content_item_id')::uuid
    AND content.campaign_id = v_job.campaign_id
  FOR UPDATE OF content;
  SELECT campaign.organization_id INTO v_organization_id
  FROM tanaghom.campaigns campaign WHERE campaign.id = v_job.campaign_id;
  IF v_content.id IS NULL OR v_content.status <> 'approved'
     OR v_job.input->>'organization_id' <> v_organization_id::text THEN
    RAISE EXCEPTION 'content is no longer approved';
  END IF;
  PERFORM 1
  FROM tanaghom.content_approvals approval
  JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
  WHERE approval.content_item_id = v_content.id
    AND approval.decision = 'approved'
    AND reviewer.organization_id = v_organization_id
    AND reviewer.kind = 'human'
    AND reviewer.role IN ('owner', 'reviewer')
    AND reviewer.is_active
    AND reviewer.accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'active human approval evidence required'; END IF;

  SELECT mapping.* INTO v_channel
  FROM tanaghom.publishing_channels mapping
  WHERE mapping.organization_id = v_organization_id
    AND mapping.provider = 'postiz'
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

REVOKE ALL ON tanaghom.integration_connections FROM PUBLIC, tanaghom_readonly, tanaghom_n8n_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tanaghom.integration_connections TO tanaghom_api;
GRANT SELECT ON tanaghom.organizations, tanaghom.integration_connection_status
  TO tanaghom_api, tanaghom_readonly;
GRANT INSERT (organization_id) ON tanaghom.app_users TO tanaghom_api;
GRANT INSERT, UPDATE, DELETE ON tanaghom.publishing_channels TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0008_customer_integrations');

COMMIT;
