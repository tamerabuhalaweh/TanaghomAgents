BEGIN;

ALTER TABLE tanaghom.automation_platform_controls
  DROP CONSTRAINT automation_platform_controls_provider_check,
  ADD CONSTRAINT automation_platform_controls_provider_check
    CHECK (provider IN ('postiz', 'ghl'));

INSERT INTO tanaghom.automation_platform_controls (provider, reason)
VALUES ('ghl', 'Awaiting controlled GHL contact-sync activation');

CREATE TABLE tanaghom.organization_crm_policies (
  organization_id uuid PRIMARY KEY REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  contact_sync_mode text NOT NULL DEFAULT 'manual'
    CHECK (contact_sync_mode IN ('manual', 'paused')),
  changed_by uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tanaghom.organization_crm_policies (organization_id)
SELECT id FROM tanaghom.organizations;

CREATE TRIGGER organization_crm_policies_updated_at
BEFORE UPDATE ON tanaghom.organization_crm_policies
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE FUNCTION tanaghom.create_organization_crm_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO tanaghom.organization_crm_policies (organization_id)
  VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_create_crm_policy
AFTER INSERT ON tanaghom.organizations
FOR EACH ROW EXECUTE FUNCTION tanaghom.create_organization_crm_policy();

CREATE TABLE tanaghom.ghl_contact_sync_state (
  lead_id uuid PRIMARY KEY REFERENCES tanaghom.leads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  sync_version integer NOT NULL DEFAULT 0 CHECK (sync_version >= 0),
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'queued', 'running', 'succeeded', 'failed')),
  provider_contact_id text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, lead_id)
);

CREATE TRIGGER ghl_contact_sync_state_updated_at
BEFORE UPDATE ON tanaghom.ghl_contact_sync_state
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE UNIQUE INDEX agent_jobs_ghl_contact_active_uidx
  ON tanaghom.agent_jobs ((input->>'lead_id'))
  WHERE job_type = 'lead.ghl.contact_upsert' AND status IN ('queued', 'running');

CREATE FUNCTION tanaghom.enforce_ghl_sync_organization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_organization_id uuid;
BEGIN
  SELECT campaign.organization_id INTO v_organization_id
    FROM tanaghom.leads lead
    JOIN tanaghom.campaigns campaign ON campaign.id = lead.campaign_id
   WHERE lead.id = NEW.lead_id;
  IF v_organization_id IS NULL OR v_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'GHL contact state crosses an organization boundary';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_contact_sync_organization_guard
BEFORE INSERT OR UPDATE ON tanaghom.ghl_contact_sync_state
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_ghl_sync_organization();

CREATE FUNCTION tanaghom.queue_ghl_contact_upsert(p_lead_id uuid, p_actor_user_id uuid)
RETURNS TABLE (job_id uuid, correlation_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
  v_campaign_id uuid;
  v_agent_id uuid;
  v_version integer;
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT actor.organization_id INTO v_organization_id
    FROM tanaghom.app_users actor
   WHERE actor.id = p_actor_user_id AND actor.kind = 'human'
     AND actor.role IN ('owner', 'operator') AND actor.is_active
     AND actor.accepted_at IS NOT NULL;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'active CRM operator required'; END IF;

  SELECT campaign.id INTO v_campaign_id
    FROM tanaghom.leads lead
    JOIN tanaghom.campaigns campaign ON campaign.id = lead.campaign_id
   WHERE lead.id = p_lead_id AND campaign.organization_id = v_organization_id
     AND (lead.contact_email IS NOT NULL OR lead.contact_phone IS NOT NULL)
   FOR UPDATE OF lead;
  IF v_campaign_id IS NULL THEN RAISE EXCEPTION 'contactable lead not found in organization'; END IF;

  PERFORM 1
    FROM tanaghom.integration_connections connection
    JOIN tanaghom.organization_crm_policies policy
      ON policy.organization_id = connection.organization_id
    JOIN tanaghom.automation_platform_controls control ON control.provider = 'ghl'
   WHERE connection.organization_id = v_organization_id
     AND connection.provider = 'ghl' AND connection.status = 'connected'
     AND policy.contact_sync_mode = 'manual' AND NOT control.emergency_stop;
  IF NOT FOUND THEN RAISE EXCEPTION 'GHL contact synchronization is not ready'; END IF;

  PERFORM 1
    FROM tanaghom.external_operations operation
    JOIN tanaghom.agent_jobs related_job ON related_job.correlation_id = operation.correlation_id
    JOIN tanaghom.campaigns campaign ON campaign.id = related_job.campaign_id
   WHERE campaign.organization_id = v_organization_id
     AND operation.provider = 'ghl' AND operation.status = 'indeterminate';
  IF FOUND THEN RAISE EXCEPTION 'indeterminate GHL operation requires human review'; END IF;

  SELECT job.* INTO v_job
    FROM tanaghom.agent_jobs job
   WHERE job.job_type = 'lead.ghl.contact_upsert'
     AND job.input->>'lead_id' = p_lead_id::text
     AND job.status IN ('queued', 'running')
   ORDER BY job.created_at DESC LIMIT 1;
  IF v_job.id IS NOT NULL THEN
    RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
    RETURN;
  END IF;

  SELECT id INTO v_agent_id FROM tanaghom.agents
   WHERE code = 'sales_crm' AND status <> 'disabled';
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'sales CRM agent is unavailable'; END IF;

  INSERT INTO tanaghom.ghl_contact_sync_state (
    lead_id, organization_id, sync_version, status
  ) VALUES (p_lead_id, v_organization_id, 1, 'queued')
  ON CONFLICT (lead_id) DO UPDATE SET
    sync_version = tanaghom.ghl_contact_sync_state.sync_version + 1,
    status = 'queued', last_error_code = NULL, last_error_message = NULL
  RETURNING sync_version INTO v_version;

  INSERT INTO tanaghom.agent_jobs (
    correlation_id, agent_id, campaign_id, job_type, max_attempts, input
  ) VALUES (
    v_correlation_id, v_agent_id, v_campaign_id, 'lead.ghl.contact_upsert', 5,
    jsonb_build_object(
      'contract_version', 'phase5.ghl-contact-upsert-job.v1',
      'organization_id', v_organization_id,
      'lead_id', p_lead_id,
      'sync_version', v_version,
      'requested_by', p_actor_user_id
    )
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type,
    entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, p_actor_user_id,
    'ghl.contact_upsert_requested', 'lead', p_lead_id,
    jsonb_build_object('sync_version', v_version, 'organization_id', v_organization_id),
    'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'ghl.contact_upsert_requested:' || v_job.id::text,
    'ghl.contact_upsert_requested', 'lead', p_lead_id,
    jsonb_build_object('job_id', v_job.id, 'lead_id', p_lead_id)
  );
  RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
END;
$$;

CREATE FUNCTION tanaghom.claim_ghl_contact_job()
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
    JOIN tanaghom.leads lead ON lead.id = (candidate.input->>'lead_id')::uuid
    JOIN tanaghom.campaigns campaign ON campaign.id = lead.campaign_id
    JOIN tanaghom.integration_connections connection
      ON connection.organization_id = campaign.organization_id
     AND connection.provider = 'ghl' AND connection.status = 'connected'
    JOIN tanaghom.organization_crm_policies policy
      ON policy.organization_id = campaign.organization_id
     AND policy.contact_sync_mode = 'manual'
    JOIN tanaghom.automation_platform_controls control
      ON control.provider = 'ghl' AND NOT control.emergency_stop
   WHERE candidate.job_type = 'lead.ghl.contact_upsert'
     AND candidate.status = 'queued' AND candidate.available_at <= statement_timestamp()
     AND candidate.attempt < candidate.max_attempts
     AND candidate.input->>'contract_version' = 'phase5.ghl-contact-upsert-job.v1'
     AND candidate.input->>'organization_id' = campaign.organization_id::text
     AND candidate.campaign_id = campaign.id
     AND agent.code = 'sales_crm' AND agent.status <> 'disabled'
     AND NOT EXISTS (
       SELECT 1 FROM tanaghom.external_operations operation
       JOIN tanaghom.agent_jobs related_job ON related_job.correlation_id = operation.correlation_id
       JOIN tanaghom.campaigns related_campaign ON related_campaign.id = related_job.campaign_id
       WHERE related_campaign.organization_id = campaign.organization_id
         AND operation.provider = 'ghl' AND operation.status = 'indeterminate'
     )
   ORDER BY candidate.available_at, candidate.created_at
   FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;
  IF v_job_id IS NULL THEN RETURN; END IF;

  UPDATE tanaghom.agent_jobs job SET status = 'running', attempt = job.attempt + 1,
    started_at = statement_timestamp(), finished_at = NULL,
    error_code = NULL, error_message = NULL WHERE job.id = v_job_id;
  UPDATE tanaghom.ghl_contact_sync_state state SET
    status = 'running', last_attempt_at = statement_timestamp()
    FROM tanaghom.agent_jobs job
    WHERE job.id = v_job_id AND state.lead_id = (job.input->>'lead_id')::uuid;
  UPDATE tanaghom.agents agent SET status = 'working', last_heartbeat_at = statement_timestamp()
    FROM tanaghom.agent_jobs job WHERE job.id = v_job_id AND agent.id = job.agent_id;
  RETURN QUERY SELECT job.id, job.correlation_id, job.campaign_id, job.job_type,
    job.attempt, job.max_attempts, job.input FROM tanaghom.agent_jobs job WHERE job.id = v_job_id;
END;
$$;

CREATE FUNCTION tanaghom.prepare_ghl_contact_upsert(p_job_id uuid)
RETURNS TABLE (
  job_id uuid, operation_id uuid, lead_id uuid, organization_id uuid,
  idempotency_key text, request_body jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_lead tanaghom.leads%ROWTYPE;
  v_organization_id uuid;
  v_location_id text;
  v_operation tanaghom.external_operations%ROWTYPE;
  v_request jsonb;
  v_key text;
BEGIN
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  SELECT lead.* INTO v_lead FROM tanaghom.leads lead
   WHERE lead.id = (v_job.input->>'lead_id')::uuid FOR SHARE;
  SELECT campaign.organization_id, connection.configuration->>'location_id'
    INTO v_organization_id, v_location_id
    FROM tanaghom.campaigns campaign
    JOIN tanaghom.integration_connections connection
      ON connection.organization_id = campaign.organization_id
     AND connection.provider = 'ghl' AND connection.status = 'connected'
   WHERE campaign.id = v_lead.campaign_id AND campaign.id = v_job.campaign_id;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'lead.ghl.contact_upsert'
     OR v_job.input->>'contract_version' <> 'phase5.ghl-contact-upsert-job.v1'
     OR v_lead.id IS NULL OR v_job.input->>'organization_id' <> v_organization_id::text
     OR coalesce(v_location_id, '') !~ '^[A-Za-z0-9_-]{3,100}$' THEN
    RAISE EXCEPTION 'job is not a running authorized GHL contact job';
  END IF;

  v_key := 'ghl-contact-upsert:' || v_lead.id::text || ':' || (v_job.input->>'sync_version');
  v_request := jsonb_strip_nulls(jsonb_build_object(
    'name', nullif(trim(coalesce(v_lead.name, '')), ''),
    'email', v_lead.contact_email,
    'phone', v_lead.contact_phone,
    'locationId', v_location_id,
    'source', 'Tanaghom',
    'createNewIfDuplicateAllowed', false
  ));

  SELECT * INTO v_operation FROM tanaghom.external_operations operation
   WHERE operation.provider = 'ghl' AND operation.operation_type = 'upsert_contact'
     AND operation.idempotency_key = v_key FOR UPDATE;
  IF v_operation.id IS NULL THEN
    INSERT INTO tanaghom.external_operations (
      correlation_id, provider, operation_type, idempotency_key, status,
      request_fingerprint, attempt
    ) VALUES (
      v_job.correlation_id, 'ghl', 'upsert_contact', v_key, 'in_progress',
      'md5:' || md5(v_request::text), v_job.attempt
    ) RETURNING * INTO v_operation;
  ELSIF v_operation.status = 'failed' AND v_operation.request_fingerprint = 'md5:' || md5(v_request::text) THEN
    UPDATE tanaghom.external_operations SET status = 'in_progress',
      response_summary = NULL, attempt = v_job.attempt
     WHERE id = v_operation.id RETURNING * INTO v_operation;
  ELSE
    RAISE EXCEPTION 'GHL contact operation cannot be replayed from its current state';
  END IF;
  RETURN QUERY SELECT v_job.id, v_operation.id, v_lead.id, v_organization_id, v_key, v_request;
END;
$$;

CREATE FUNCTION tanaghom.complete_ghl_contact_upsert(p_job_id uuid, p_result jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_lead_id uuid;
  v_contact_id text;
  v_location_id text;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
     OR p_result->>'contract_version' <> 'phase5.ghl-contact-upsert-result.v1'
     OR length(trim(coalesce(p_result->>'provider_contact_id', ''))) NOT BETWEEN 3 AND 300
     OR length(trim(coalesce(p_result->>'location_id', ''))) NOT BETWEEN 3 AND 100
     OR jsonb_typeof(p_result->'created') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid GHL contact result contract';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running' OR v_job.job_type <> 'lead.ghl.contact_upsert' THEN
    RAISE EXCEPTION 'job is not a running GHL contact job';
  END IF;
  v_lead_id := (v_job.input->>'lead_id')::uuid;
  v_contact_id := trim(p_result->>'provider_contact_id');
  SELECT connection.configuration->>'location_id' INTO v_location_id
    FROM tanaghom.integration_connections connection
   WHERE connection.organization_id = (v_job.input->>'organization_id')::uuid
     AND connection.provider = 'ghl';
  IF v_location_id IS DISTINCT FROM p_result->>'location_id' THEN
    RAISE EXCEPTION 'GHL result location does not match the authorized organization';
  END IF;
  PERFORM 1 FROM tanaghom.external_operations
   WHERE correlation_id = v_job.correlation_id AND provider = 'ghl'
     AND operation_type = 'upsert_contact' AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'matching GHL contact operation is not in progress'; END IF;

  UPDATE tanaghom.leads SET ghl_contact_id = v_contact_id WHERE id = v_lead_id;
  UPDATE tanaghom.ghl_contact_sync_state SET status = 'succeeded',
    provider_contact_id = v_contact_id, consecutive_failures = 0,
    last_success_at = statement_timestamp(), last_error_code = NULL,
    last_error_message = NULL WHERE lead_id = v_lead_id;
  UPDATE tanaghom.external_operations SET status = 'succeeded',
    provider_reference = v_contact_id,
    response_summary = jsonb_build_object('created', p_result->'created')
   WHERE correlation_id = v_job.correlation_id AND provider = 'ghl'
     AND operation_type = 'upsert_contact' AND status = 'in_progress';
  UPDATE tanaghom.agent_jobs SET status = 'succeeded', output = p_result,
    finished_at = statement_timestamp() WHERE id = v_job.id;
  UPDATE tanaghom.agents SET status = 'idle', last_heartbeat_at = statement_timestamp()
   WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_job.agent_id, 'ghl.contact_upserted',
    'lead', v_lead_id, jsonb_build_object('provider_contact_id', v_contact_id), 'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'ghl.contact_upserted:' || v_job.id::text,
    'ghl.contact_upserted', 'lead', v_lead_id,
    jsonb_build_object('job_id', v_job.id, 'provider_contact_id', v_contact_id)
  );
  RETURN v_contact_id;
END;
$$;

CREATE FUNCTION tanaghom.record_ghl_contact_failure(
  p_job_id uuid, p_error_code text, p_error_message text,
  p_http_status integer, p_retry_after_seconds integer DEFAULT 300
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_lead_id uuid;
  v_next_status text;
BEGIN
  IF length(trim(coalesce(p_error_code, ''))) = 0
     OR length(trim(coalesce(p_error_message, ''))) = 0
     OR p_http_status IS NULL OR p_http_status NOT BETWEEN 0 AND 599
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'valid bounded GHL contact failure required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running' OR v_job.job_type <> 'lead.ghl.contact_upsert' THEN
    RAISE EXCEPTION 'job is not a running GHL contact job';
  END IF;
  v_lead_id := (v_job.input->>'lead_id')::uuid;
  v_next_status := CASE
    WHEN (p_http_status = 0 OR p_http_status IN (408, 429) OR p_http_status >= 500)
      AND v_job.attempt < v_job.max_attempts THEN 'queued'
    ELSE 'failed' END;
  UPDATE tanaghom.external_operations SET status = 'failed',
    response_summary = jsonb_build_object('error_code', left(trim(p_error_code), 120), 'http_status', p_http_status)
   WHERE correlation_id = v_job.correlation_id AND provider = 'ghl'
     AND operation_type = 'upsert_contact' AND status = 'in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'matching GHL contact operation is not in progress'; END IF;
  UPDATE tanaghom.agent_jobs SET status = v_next_status,
    error_code = left(trim(p_error_code), 120), error_message = left(trim(p_error_message), 4000),
    available_at = CASE WHEN v_next_status = 'queued'
      THEN statement_timestamp() + make_interval(secs => p_retry_after_seconds) ELSE available_at END,
    finished_at = CASE WHEN v_next_status = 'failed' THEN statement_timestamp() ELSE NULL END
   WHERE id = v_job.id;
  UPDATE tanaghom.ghl_contact_sync_state SET status = v_next_status,
    consecutive_failures = consecutive_failures + 1,
    last_error_code = left(trim(p_error_code), 120),
    last_error_message = left(trim(p_error_message), 1000)
   WHERE lead_id = v_lead_id;
  UPDATE tanaghom.agents SET status = CASE WHEN v_next_status = 'queued' THEN 'idle' ELSE 'failed' END,
    last_heartbeat_at = statement_timestamp() WHERE id = v_job.agent_id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, agent_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_job.agent_id, 'ghl.contact_upsert_failed',
    'lead', v_lead_id, jsonb_build_object('error_code', left(trim(p_error_code), 120),
      'http_status', p_http_status, 'next_status', v_next_status), 'failed'
  );
  IF v_next_status = 'failed' THEN
    INSERT INTO tanaghom.notifications (user_id, severity, title, body, entity_type, entity_id)
    SELECT app.id, 'error', 'GoHighLevel contact sync failed',
      'A CRM contact could not be synchronized after bounded retries. Review the connection and job evidence.',
      'lead', v_lead_id
    FROM tanaghom.app_users app
    WHERE app.organization_id = (v_job.input->>'organization_id')::uuid
      AND app.role = 'owner' AND app.is_active AND app.accepted_at IS NOT NULL;
  END IF;
  RETURN v_next_status;
END;
$$;

REVOKE ALL ON tanaghom.organization_crm_policies FROM PUBLIC, tanaghom_n8n_worker;
REVOKE ALL ON tanaghom.ghl_contact_sync_state FROM PUBLIC, tanaghom_n8n_worker;
REVOKE ALL ON FUNCTION tanaghom.create_organization_crm_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.enforce_ghl_sync_organization() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.queue_ghl_contact_upsert(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_ghl_contact_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.prepare_ghl_contact_upsert(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.complete_ghl_contact_upsert(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_contact_failure(uuid, text, text, integer, integer) FROM PUBLIC;

GRANT SELECT ON tanaghom.organization_crm_policies, tanaghom.ghl_contact_sync_state
  TO tanaghom_api, tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.queue_ghl_contact_upsert(uuid, uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_contact_job() TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.prepare_ghl_contact_upsert(uuid) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.complete_ghl_contact_upsert(uuid, jsonb) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.record_ghl_contact_failure(uuid, text, text, integer, integer)
  TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0011_ghl_contact_sync');

COMMIT;
