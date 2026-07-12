BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA tanaghom;

CREATE FUNCTION tanaghom.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE tanaghom.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  kind text NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'service')),
  role text NOT NULL CHECK (role IN ('owner', 'reviewer', 'operator', 'viewer', 'service')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'service' AND role = 'service') OR kind = 'human')
);

CREATE TABLE tanaghom.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  brief text NOT NULL CHECK (length(trim(brief)) > 0),
  product_type text NOT NULL CHECK (product_type IN ('camp', 'book', 'coaching_program', 'course')),
  target_audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(target_audience) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'blocked_missing_info', 'strategy_ready', 'content_in_progress',
    'awaiting_approval', 'active', 'paused', 'closed'
  )),
  blocked_reason text,
  budget_target numeric(14,2) CHECK (budget_target IS NULL OR budget_target >= 0),
  revenue_target numeric(14,2) CHECK (revenue_target IS NULL OR revenue_target >= 0),
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = upper(currency)),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'blocked_missing_info' AND length(trim(coalesce(blocked_reason, ''))) > 0)
    OR status <> 'blocked_missing_info'
  )
);

CREATE TABLE tanaghom.campaign_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES tanaghom.campaigns(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  positioning text NOT NULL,
  key_messages jsonb NOT NULL CHECK (jsonb_typeof(key_messages) = 'array'),
  channels jsonb NOT NULL CHECK (jsonb_typeof(channels) = 'array'),
  posting_cadence jsonb NOT NULL CHECK (jsonb_typeof(posting_cadence) = 'object'),
  content_pillars jsonb NOT NULL CHECK (jsonb_typeof(content_pillars) = 'array'),
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version),
  UNIQUE (id, campaign_id)
);

CREATE TABLE tanaghom.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting_approval', 'blocked', 'failed', 'disabled')),
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tanaghom.agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES tanaghom.agents(id),
  campaign_id uuid REFERENCES tanaghom.campaigns(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0 AND attempt <= max_attempts),
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  output jsonb,
  error_code text,
  error_message text,
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, correlation_id, job_type),
  CHECK ((status IN ('failed', 'cancelled') AND finished_at IS NOT NULL) OR status NOT IN ('failed', 'cancelled')),
  CHECK ((status = 'succeeded' AND finished_at IS NOT NULL) OR status <> 'succeeded')
);

CREATE TABLE tanaghom.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES tanaghom.campaigns(id) ON DELETE CASCADE,
  strategy_id uuid NOT NULL,
  parent_content_id uuid REFERENCES tanaghom.content_items(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  channel text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('post', 'reel_script', 'ad_copy', 'email')),
  draft_copy text NOT NULL,
  media_brief text NOT NULL,
  media_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'posted', 'cancelled')),
  scheduled_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_content_id, generation),
  CHECK ((status = 'scheduled' AND scheduled_time IS NOT NULL) OR status <> 'scheduled'),
  FOREIGN KEY (strategy_id, campaign_id) REFERENCES tanaghom.campaign_strategies(id, campaign_id)
);

CREATE TABLE tanaghom.content_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES tanaghom.content_items(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  rejection_reason text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (decision = 'rejected' AND length(trim(coalesce(rejection_reason, ''))) > 0)
    OR (decision = 'approved' AND rejection_reason IS NULL)
  )
);

CREATE FUNCTION tanaghom.enforce_human_content_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1
      FROM tanaghom.content_approvals approval
      JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
      WHERE approval.content_item_id = NEW.id
        AND approval.decision = NEW.status
        AND reviewer.kind = 'human'
        AND reviewer.role IN ('owner', 'reviewer')
        AND reviewer.is_active
    ) THEN
      RAISE EXCEPTION 'content status % requires a matching decision by an active human reviewer', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_campaign_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (CASE OLD.status
    WHEN 'draft' THEN NEW.status IN ('blocked_missing_info', 'strategy_ready', 'closed')
    WHEN 'blocked_missing_info' THEN NEW.status IN ('draft', 'closed')
    WHEN 'strategy_ready' THEN NEW.status IN ('content_in_progress', 'closed')
    WHEN 'content_in_progress' THEN NEW.status IN ('awaiting_approval', 'paused', 'closed')
    WHEN 'awaiting_approval' THEN NEW.status IN ('content_in_progress', 'active', 'paused', 'closed')
    WHEN 'active' THEN NEW.status IN ('paused', 'closed')
    WHEN 'paused' THEN NEW.status IN ('active', 'closed')
    WHEN 'closed' THEN false
    ELSE false
  END) THEN
    RAISE EXCEPTION 'invalid campaign status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_content_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (CASE OLD.status
    WHEN 'draft' THEN NEW.status IN ('pending_approval', 'cancelled')
    WHEN 'pending_approval' THEN NEW.status IN ('approved', 'rejected', 'cancelled')
    WHEN 'rejected' THEN NEW.status IN ('draft', 'cancelled')
    WHEN 'approved' THEN NEW.status IN ('scheduled', 'posted', 'cancelled')
    WHEN 'scheduled' THEN NEW.status IN ('posted', 'cancelled')
    WHEN 'posted' THEN false
    WHEN 'cancelled' THEN false
    ELSE false
  END) THEN
    RAISE EXCEPTION 'invalid content status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_job_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (CASE OLD.status
    WHEN 'queued' THEN NEW.status IN ('running', 'cancelled')
    WHEN 'running' THEN NEW.status IN ('queued', 'waiting_approval', 'succeeded', 'failed', 'cancelled')
    WHEN 'waiting_approval' THEN NEW.status IN ('running', 'succeeded', 'failed', 'cancelled')
    WHEN 'failed' THEN NEW.status IN ('queued', 'cancelled')
    WHEN 'succeeded' THEN false
    WHEN 'cancelled' THEN false
    ELSE false
  END) THEN
    RAISE EXCEPTION 'invalid agent job status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE tanaghom.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL UNIQUE REFERENCES tanaghom.content_items(id),
  provider text NOT NULL DEFAULT 'postiz',
  provider_post_id text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'live', 'failed', 'removed')),
  posted_at timestamptz,
  impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  engagement_rate numeric(8,5) CHECK (engagement_rate IS NULL OR engagement_rate >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  spend numeric(14,2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_post_id)
);

CREATE FUNCTION tanaghom.enforce_publishable_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM tanaghom.content_items content
    JOIN tanaghom.content_approvals approval ON approval.content_item_id = content.id
    JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
    WHERE content.id = NEW.content_item_id
      AND content.status IN ('approved', 'scheduled', 'posted')
      AND approval.decision = 'approved'
      AND reviewer.kind = 'human'
      AND reviewer.role IN ('owner', 'reviewer')
      AND reviewer.is_active
  ) THEN
    RAISE EXCEPTION 'post creation requires approved content and an active human reviewer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE tanaghom.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES tanaghom.campaigns(id),
  source_post_id uuid REFERENCES tanaghom.posts(id) ON DELETE SET NULL,
  name text,
  contact_email text,
  contact_phone text,
  ghl_contact_id text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost', 'nurture')),
  temperature text NOT NULL DEFAULT 'cold' CHECK (temperature IN ('hot', 'warm', 'cold')),
  available_for_requeue boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_touch_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);

CREATE TABLE tanaghom.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email', 'sms', 'call_script')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by uuid REFERENCES tanaghom.app_users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status <> 'approved')
);

CREATE TABLE tanaghom.sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES tanaghom.leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('outreach', 'follow_up', 'meeting', 'purchase', 'lost', 'note')),
  channel text CHECK (channel IN ('whatsapp', 'email', 'sms', 'call', 'system')),
  template_id uuid REFERENCES tanaghom.message_templates(id),
  notes text,
  outcome text,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (activity_type NOT IN ('outreach', 'follow_up') OR template_id IS NOT NULL)
);

CREATE TABLE tanaghom.external_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  provider text NOT NULL,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed', 'indeterminate')),
  request_fingerprint text NOT NULL,
  provider_reference text,
  response_summary jsonb,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, operation_type, idempotency_key)
);

CREATE TABLE tanaghom.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tanaghom.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tanaghom.agent_actions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  job_id uuid REFERENCES tanaghom.agent_jobs(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES tanaghom.agents(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  result text NOT NULL CHECK (result IN ('success', 'failed', 'blocked_pending_approval', 'blocked_missing_info', 'skipped_duplicate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (agent_id IS NOT NULL OR actor_user_id IS NOT NULL)
);

CREATE FUNCTION tanaghom.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent_actions_log is immutable';
END;
$$;

CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON tanaghom.app_users FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON tanaghom.campaigns FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON tanaghom.agents FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER agent_jobs_updated_at BEFORE UPDATE ON tanaghom.agent_jobs FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER content_items_updated_at BEFORE UPDATE ON tanaghom.content_items FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER posts_updated_at BEFORE UPDATE ON tanaghom.posts FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON tanaghom.leads FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER message_templates_updated_at BEFORE UPDATE ON tanaghom.message_templates FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER external_operations_updated_at BEFORE UPDATE ON tanaghom.external_operations FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER campaign_status_transition BEFORE UPDATE OF status ON tanaghom.campaigns FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_campaign_status_transition();
CREATE TRIGGER content_human_decision BEFORE UPDATE OF status ON tanaghom.content_items FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_human_content_decision();
CREATE TRIGGER content_status_transition BEFORE UPDATE OF status ON tanaghom.content_items FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_content_status_transition();
CREATE TRIGGER job_status_transition BEFORE UPDATE OF status ON tanaghom.agent_jobs FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_job_status_transition();
CREATE TRIGGER post_requires_approval BEFORE INSERT OR UPDATE OF content_item_id ON tanaghom.posts FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_publishable_content();
CREATE TRIGGER audit_no_update BEFORE UPDATE ON tanaghom.agent_actions_log FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER audit_no_delete BEFORE DELETE ON tanaghom.agent_actions_log FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

CREATE INDEX campaigns_status_idx ON tanaghom.campaigns(status);
CREATE INDEX content_items_campaign_status_idx ON tanaghom.content_items(campaign_id, status);
CREATE INDEX content_approvals_content_time_idx ON tanaghom.content_approvals(content_item_id, decided_at DESC);
CREATE INDEX agent_jobs_claim_idx ON tanaghom.agent_jobs(status, available_at) WHERE status = 'queued';
CREATE INDEX outbox_events_claim_idx ON tanaghom.outbox_events(status, available_at) WHERE status IN ('pending', 'failed');
CREATE INDEX leads_campaign_status_idx ON tanaghom.leads(campaign_id, status);
CREATE INDEX agent_actions_correlation_idx ON tanaghom.agent_actions_log(correlation_id, created_at);

INSERT INTO public.schema_migrations(version) VALUES ('0001_shared_foundation');

COMMIT;
