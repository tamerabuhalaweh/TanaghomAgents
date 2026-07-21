BEGIN;

ALTER TABLE tanaghom.campaigns
  ADD COLUMN content_item_target integer NOT NULL DEFAULT 2
    CHECK (content_item_target BETWEEN 1 AND 12);

CREATE UNIQUE INDEX agent_jobs_one_open_core_job_per_campaign_idx
  ON tanaghom.agent_jobs(campaign_id, job_type)
  WHERE campaign_id IS NOT NULL
    AND job_type IN ('campaign.strategy.generate', 'campaign.content.generate')
    AND status IN ('queued', 'running', 'waiting_approval');

CREATE FUNCTION tanaghom.create_campaign_draft(
  p_actor_user_id uuid,
  p_name text,
  p_brief text,
  p_product_type text,
  p_target_audience jsonb,
  p_budget_target numeric,
  p_revenue_target numeric,
  p_currency text,
  p_content_item_target integer
)
RETURNS TABLE (campaign_id uuid, campaign_status text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_campaign tanaghom.campaigns%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
  v_audience text;
  v_geography text;
  v_languages_valid boolean := false;
BEGIN
  SELECT actor.* INTO v_actor
  FROM tanaghom.app_users actor
  JOIN tanaghom.organizations organization
    ON organization.id = actor.organization_id AND organization.is_active
  WHERE actor.id = p_actor_user_id
    AND actor.kind = 'human'
    AND actor.role IN ('owner', 'operator')
    AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active campaign operator required'; END IF;

  v_audience := trim(coalesce(p_target_audience->>'audience', p_target_audience->>'description', ''));
  v_geography := trim(coalesce(p_target_audience->>'geography', p_target_audience->>'geographies', ''));
  IF jsonb_typeof(p_target_audience->'languages') = 'array' THEN
    v_languages_valid := jsonb_array_length(p_target_audience->'languages') BETWEEN 1 AND 2
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_target_audience->'languages') language(value)
        WHERE language.value NOT IN ('en', 'ar')
      );
  END IF;
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 200
     OR length(trim(coalesce(p_brief, ''))) NOT BETWEEN 20 AND 12000
     OR p_product_type NOT IN ('camp', 'book', 'coaching_program', 'course')
     OR p_target_audience IS NULL OR jsonb_typeof(p_target_audience) <> 'object'
     OR length(v_audience) < 10 OR length(v_geography) < 2
     OR NOT v_languages_valid
     OR (p_budget_target IS NOT NULL AND p_budget_target < 0)
     OR (p_revenue_target IS NOT NULL AND p_revenue_target < 0)
     OR trim(coalesce(p_currency, '')) !~ '^[A-Za-z]{3}$'
     OR p_content_item_target IS NULL OR p_content_item_target NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'valid campaign brief, audience, targets, and content count required';
  END IF;

  INSERT INTO tanaghom.campaigns (
    name, brief, product_type, target_audience, status, budget_target,
    revenue_target, currency, content_item_target, created_by, organization_id
  ) VALUES (
    trim(p_name), trim(p_brief), p_product_type, p_target_audience, 'draft',
    p_budget_target, p_revenue_target, upper(trim(p_currency)),
    p_content_item_target, v_actor.id, v_actor.organization_id
  ) RETURNING * INTO v_campaign;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_correlation_id, v_actor.id, 'campaign.created', 'campaign', v_campaign.id,
    jsonb_build_object(
      'organization_id', v_actor.organization_id,
      'product_type', v_campaign.product_type,
      'content_item_target', v_campaign.content_item_target
    ), 'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_correlation_id, 'campaign.created:' || v_campaign.id::text,
    'campaign.created', 'campaign', v_campaign.id,
    jsonb_build_object('campaign_id', v_campaign.id, 'organization_id', v_actor.organization_id)
  );

  RETURN QUERY SELECT v_campaign.id, v_campaign.status, v_campaign.created_at;
END;
$$;

CREATE FUNCTION tanaghom.revise_campaign_brief(
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_brief text,
  p_product_type text,
  p_target_audience jsonb,
  p_budget_target numeric,
  p_revenue_target numeric,
  p_currency text,
  p_content_item_target integer
)
RETURNS TABLE (campaign_id uuid, campaign_status text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_campaign tanaghom.campaigns%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
  v_audience text;
  v_geography text;
  v_languages_valid boolean := false;
BEGIN
  SELECT actor.* INTO v_actor
  FROM tanaghom.app_users actor
  JOIN tanaghom.organizations organization
    ON organization.id = actor.organization_id AND organization.is_active
  WHERE actor.id = p_actor_user_id
    AND actor.kind = 'human'
    AND actor.role IN ('owner', 'operator')
    AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active campaign operator required'; END IF;

  SELECT campaign.* INTO v_campaign
  FROM tanaghom.campaigns campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = v_actor.organization_id
  FOR UPDATE;
  IF v_campaign.id IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  IF v_campaign.status NOT IN ('draft', 'blocked_missing_info') THEN
    RAISE EXCEPTION 'campaign brief cannot be revised from its current status';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs job
    WHERE job.campaign_id = v_campaign.id
      AND job.job_type IN ('campaign.strategy.generate', 'campaign.content.generate')
      AND job.status IN ('queued', 'running', 'waiting_approval')
  ) THEN RAISE EXCEPTION 'campaign has active core work'; END IF;

  v_audience := trim(coalesce(p_target_audience->>'audience', p_target_audience->>'description', ''));
  v_geography := trim(coalesce(p_target_audience->>'geography', p_target_audience->>'geographies', ''));
  IF jsonb_typeof(p_target_audience->'languages') = 'array' THEN
    v_languages_valid := jsonb_array_length(p_target_audience->'languages') BETWEEN 1 AND 2
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_target_audience->'languages') language(value)
        WHERE language.value NOT IN ('en', 'ar')
      );
  END IF;
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 200
     OR length(trim(coalesce(p_brief, ''))) NOT BETWEEN 20 AND 12000
     OR p_product_type NOT IN ('camp', 'book', 'coaching_program', 'course')
     OR p_target_audience IS NULL OR jsonb_typeof(p_target_audience) <> 'object'
     OR length(v_audience) < 10 OR length(v_geography) < 2
     OR NOT v_languages_valid
     OR (p_budget_target IS NOT NULL AND p_budget_target < 0)
     OR (p_revenue_target IS NOT NULL AND p_revenue_target < 0)
     OR trim(coalesce(p_currency, '')) !~ '^[A-Za-z]{3}$'
     OR p_content_item_target IS NULL OR p_content_item_target NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'valid campaign brief, audience, targets, and content count required';
  END IF;

  UPDATE tanaghom.campaigns campaign
  SET name = trim(p_name), brief = trim(p_brief), product_type = p_product_type,
      target_audience = p_target_audience, budget_target = p_budget_target,
      revenue_target = p_revenue_target, currency = upper(trim(p_currency)),
      content_item_target = p_content_item_target, status = 'draft', blocked_reason = NULL
  WHERE campaign.id = v_campaign.id
  RETURNING * INTO v_campaign;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_correlation_id, v_actor.id, 'campaign.brief_revised', 'campaign', v_campaign.id,
    jsonb_build_object('organization_id', v_actor.organization_id), 'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_correlation_id, 'campaign.brief_revised:' || v_correlation_id::text,
    'campaign.brief_revised', 'campaign', v_campaign.id,
    jsonb_build_object('campaign_id', v_campaign.id)
  );

  RETURN QUERY SELECT v_campaign.id, v_campaign.status, v_campaign.updated_at;
END;
$$;

CREATE FUNCTION tanaghom.queue_campaign_strategy(
  p_campaign_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (job_id uuid, correlation_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_campaign tanaghom.campaigns%ROWTYPE;
  v_agent_id uuid;
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_job_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT actor.* INTO v_actor
  FROM tanaghom.app_users actor
  JOIN tanaghom.organizations organization
    ON organization.id = actor.organization_id AND organization.is_active
  WHERE actor.id = p_actor_user_id AND actor.kind = 'human'
    AND actor.role IN ('owner', 'operator') AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active campaign operator required'; END IF;

  SELECT campaign.* INTO v_campaign
  FROM tanaghom.campaigns campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = v_actor.organization_id
  FOR UPDATE;
  IF v_campaign.id IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  IF v_campaign.status <> 'draft' THEN RAISE EXCEPTION 'draft campaign required'; END IF;

  SELECT job.* INTO v_job
  FROM tanaghom.agent_jobs job
  WHERE job.campaign_id = v_campaign.id
    AND job.job_type = 'campaign.strategy.generate'
    AND job.status IN ('queued', 'running', 'waiting_approval')
  ORDER BY job.created_at DESC LIMIT 1;
  IF v_job.id IS NOT NULL THEN
    RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
    RETURN;
  END IF;

  SELECT agent.id INTO v_agent_id
  FROM tanaghom.agents agent
  WHERE agent.code = 'campaign_strategist' AND agent.status <> 'disabled';
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'campaign strategist is unavailable'; END IF;

  INSERT INTO tanaghom.agent_jobs (
    id, correlation_id, agent_id, campaign_id, job_type, status,
    attempt, max_attempts, input
  ) VALUES (
    v_job_id, v_correlation_id, v_agent_id, v_campaign.id,
    'campaign.strategy.generate', 'queued', 0, 3,
    jsonb_build_object(
      'contract_version', 'phase3.strategist-job.v1',
      'job_id', v_job_id,
      'correlation_id', v_correlation_id,
      'campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', v_campaign.id,
        'name', v_campaign.name,
        'brief', v_campaign.brief,
        'product_type', v_campaign.product_type,
        'target_audience', v_campaign.target_audience,
        'budget_target', v_campaign.budget_target,
        'revenue_target', v_campaign.revenue_target,
        'currency', v_campaign.currency
      ))
    )
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type,
    entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_actor.id, 'campaign.strategy_requested',
    'campaign', v_campaign.id,
    jsonb_build_object('job_id', v_job.id, 'organization_id', v_actor.organization_id),
    'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'campaign.strategy_requested:' || v_job.id::text,
    'campaign.strategy_requested', 'campaign', v_campaign.id,
    jsonb_build_object('job_id', v_job.id, 'campaign_id', v_campaign.id)
  );

  RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
END;
$$;

CREATE FUNCTION tanaghom.queue_campaign_content(
  p_campaign_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (job_id uuid, correlation_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_campaign tanaghom.campaigns%ROWTYPE;
  v_strategy tanaghom.campaign_strategies%ROWTYPE;
  v_agent_id uuid;
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_job_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT actor.* INTO v_actor
  FROM tanaghom.app_users actor
  JOIN tanaghom.organizations organization
    ON organization.id = actor.organization_id AND organization.is_active
  WHERE actor.id = p_actor_user_id AND actor.kind = 'human'
    AND actor.role IN ('owner', 'operator') AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active campaign operator required'; END IF;

  SELECT campaign.* INTO v_campaign
  FROM tanaghom.campaigns campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = v_actor.organization_id
  FOR UPDATE;
  IF v_campaign.id IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  IF v_campaign.status <> 'strategy_ready' THEN RAISE EXCEPTION 'strategy-ready campaign required'; END IF;

  SELECT job.* INTO v_job
  FROM tanaghom.agent_jobs job
  WHERE job.campaign_id = v_campaign.id
    AND job.job_type = 'campaign.content.generate'
    AND job.status IN ('queued', 'running', 'waiting_approval')
  ORDER BY job.created_at DESC LIMIT 1;
  IF v_job.id IS NOT NULL THEN
    RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM tanaghom.content_items content WHERE content.campaign_id = v_campaign.id) THEN
    RAISE EXCEPTION 'campaign content already exists';
  END IF;
  SELECT strategy.* INTO v_strategy
  FROM tanaghom.campaign_strategies strategy
  WHERE strategy.campaign_id = v_campaign.id
  ORDER BY strategy.version DESC LIMIT 1;
  IF v_strategy.id IS NULL THEN RAISE EXCEPTION 'persisted campaign strategy required'; END IF;

  SELECT agent.id INTO v_agent_id
  FROM tanaghom.agents agent
  WHERE agent.code = 'content_producer' AND agent.status <> 'disabled';
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'content producer is unavailable'; END IF;

  INSERT INTO tanaghom.agent_jobs (
    id, correlation_id, agent_id, campaign_id, job_type, status,
    attempt, max_attempts, input
  ) VALUES (
    v_job_id, v_correlation_id, v_agent_id, v_campaign.id,
    'campaign.content.generate', 'queued', 0, 3,
    jsonb_build_object(
      'contract_version', 'phase3.content-producer-job.v1',
      'job_id', v_job_id,
      'correlation_id', v_correlation_id,
      'campaign', jsonb_build_object(
        'id', v_campaign.id,
        'name', v_campaign.name,
        'brief', v_campaign.brief,
        'product_type', v_campaign.product_type,
        'target_audience', v_campaign.target_audience
      ),
      'strategy', jsonb_build_object(
        'id', v_strategy.id,
        'version', v_strategy.version,
        'positioning', v_strategy.positioning,
        'key_messages', v_strategy.key_messages,
        'channels', v_strategy.channels,
        'posting_cadence', v_strategy.posting_cadence,
        'content_pillars', v_strategy.content_pillars
      ),
      'max_items', v_campaign.content_item_target
    )
  ) RETURNING * INTO v_job;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, job_id, actor_user_id, action_type, entity_type,
    entity_id, payload, result
  ) VALUES (
    v_job.correlation_id, v_job.id, v_actor.id, 'campaign.content_requested',
    'campaign', v_campaign.id,
    jsonb_build_object(
      'job_id', v_job.id,
      'strategy_id', v_strategy.id,
      'max_items', v_campaign.content_item_target,
      'organization_id', v_actor.organization_id
    ), 'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_job.correlation_id, 'campaign.content_requested:' || v_job.id::text,
    'campaign.content_requested', 'campaign', v_campaign.id,
    jsonb_build_object('job_id', v_job.id, 'campaign_id', v_campaign.id, 'strategy_id', v_strategy.id)
  );

  RETURN QUERY SELECT v_job.id, v_job.correlation_id, v_job.status;
END;
$$;

CREATE FUNCTION tanaghom.reconcile_campaign_content_jobs(
  p_campaign_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (completed_jobs integer, ready_for_handoff boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_campaign_id uuid;
  v_job record;
  v_completed integer := 0;
  v_ready boolean := false;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT actor.* INTO v_actor
  FROM tanaghom.app_users actor
  JOIN tanaghom.organizations organization
    ON organization.id = actor.organization_id AND organization.is_active
  WHERE actor.id = p_actor_user_id AND actor.kind = 'human'
    AND actor.role IN ('owner', 'reviewer') AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active human reviewer required'; END IF;

  SELECT campaign.id INTO v_campaign_id
  FROM tanaghom.campaigns campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = v_actor.organization_id
  FOR UPDATE;
  IF v_campaign_id IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;

  FOR v_job IN
    SELECT job.id FROM tanaghom.agent_jobs job
    WHERE job.campaign_id = v_campaign_id
      AND job.job_type = 'campaign.content.generate'
      AND job.status = 'waiting_approval'
    ORDER BY job.created_at
  LOOP
    IF tanaghom.complete_content_job(v_job.id) THEN
      v_completed := v_completed + 1;
    END IF;
  END LOOP;

  v_ready := EXISTS (
    SELECT 1 FROM tanaghom.content_items content
    WHERE content.campaign_id = v_campaign_id
  ) AND NOT EXISTS (
    SELECT 1 FROM tanaghom.content_items content
    WHERE content.campaign_id = v_campaign_id
      AND content.status = 'pending_approval'
  ) AND NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs job
    WHERE job.campaign_id = v_campaign_id
      AND job.job_type = 'campaign.content.generate'
      AND job.status IN ('queued', 'running', 'waiting_approval')
  );

  IF v_completed > 0 THEN
    INSERT INTO tanaghom.agent_actions_log (
      correlation_id, actor_user_id, action_type, entity_type, entity_id,
      payload, result
    ) VALUES (
      v_correlation_id, v_actor.id, 'campaign.review_reconciled',
      'campaign', v_campaign_id,
      jsonb_build_object('completed_jobs', v_completed, 'ready_for_handoff', v_ready),
      'success'
    );
  END IF;

  RETURN QUERY SELECT v_completed, v_ready;
END;
$$;

CREATE FUNCTION tanaghom.mark_campaign_ready(
  p_campaign_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (campaign_id uuid, campaign_status text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_campaign tanaghom.campaigns%ROWTYPE;
  v_job record;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT actor.* INTO v_actor
  FROM tanaghom.app_users actor
  JOIN tanaghom.organizations organization
    ON organization.id = actor.organization_id AND organization.is_active
  WHERE actor.id = p_actor_user_id AND actor.kind = 'human'
    AND actor.role IN ('owner', 'operator') AND actor.is_active
    AND actor.accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active campaign operator required'; END IF;

  SELECT campaign.* INTO v_campaign
  FROM tanaghom.campaigns campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = v_actor.organization_id
  FOR UPDATE;
  IF v_campaign.id IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  IF v_campaign.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'campaign is not at the approval boundary';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.content_items content
    WHERE content.campaign_id = v_campaign.id AND content.status = 'approved'
  ) THEN RAISE EXCEPTION 'at least one approved content item required'; END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.content_items content
    WHERE content.campaign_id = v_campaign.id AND content.status = 'pending_approval'
  ) THEN RAISE EXCEPTION 'every content item requires a human decision'; END IF;

  -- Reconcile a reviewed content job defensively. The normal approval API performs
  -- this immediately after the final decision, while this keeps older reviewed
  -- campaign records from becoming permanently stranded at the handoff boundary.
  FOR v_job IN
    SELECT job.id FROM tanaghom.agent_jobs job
    WHERE job.campaign_id = v_campaign.id
      AND job.job_type = 'campaign.content.generate'
      AND job.status = 'waiting_approval'
    ORDER BY job.created_at
  LOOP
    PERFORM tanaghom.complete_content_job(v_job.id);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs job
    WHERE job.campaign_id = v_campaign.id
      AND job.job_type IN ('campaign.strategy.generate', 'campaign.content.generate')
      AND job.status IN ('queued', 'running', 'waiting_approval', 'failed')
  ) THEN RAISE EXCEPTION 'core campaign jobs are not complete'; END IF;

  UPDATE tanaghom.campaigns campaign
  SET status = 'active', blocked_reason = NULL
  WHERE campaign.id = v_campaign.id
  RETURNING * INTO v_campaign;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id,
    payload, result
  ) VALUES (
    v_correlation_id, v_actor.id, 'campaign.ready_for_handoff',
    'campaign', v_campaign.id,
    jsonb_build_object('organization_id', v_actor.organization_id), 'success'
  );
  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_correlation_id, 'campaign.ready_for_handoff:' || v_campaign.id::text,
    'campaign.ready_for_handoff', 'campaign', v_campaign.id,
    jsonb_build_object('campaign_id', v_campaign.id, 'organization_id', v_actor.organization_id)
  );

  RETURN QUERY SELECT v_campaign.id, v_campaign.status, v_campaign.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer)
  FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.revise_campaign_brief(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,integer)
  FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.queue_campaign_strategy(uuid,uuid)
  FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.queue_campaign_content(uuid,uuid)
  FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.reconcile_campaign_content_jobs(uuid,uuid)
  FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.mark_campaign_ready(uuid,uuid)
  FROM PUBLIC, tanaghom_n8n_worker, tanaghom_readonly;

GRANT EXECUTE ON FUNCTION tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.revise_campaign_brief(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,integer)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.queue_campaign_strategy(uuid,uuid)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.queue_campaign_content(uuid,uuid)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.reconcile_campaign_content_jobs(uuid,uuid)
  TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.mark_campaign_ready(uuid,uuid)
  TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0023_campaign_lifecycle');

COMMIT;
