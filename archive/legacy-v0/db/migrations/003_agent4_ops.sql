-- =============================================================================
-- 003 — Agent 4 + ops hardening (templates, requeue, reports, staging, idempotency)
-- Safe to run on DBs that already applied 001/002.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- campaigns: staging isolation (never hit real spend/leads on staging)
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS is_staging BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'staging'
    CHECK (environment IN ('staging', 'production'));

CREATE INDEX IF NOT EXISTS idx_campaigns_environment ON campaigns (environment);
CREATE INDEX IF NOT EXISTS idx_campaigns_staging ON campaigns (is_staging) WHERE is_staging = true;

-- ---------------------------------------------------------------------------
-- content_items / posts: stronger idempotency markers
-- ---------------------------------------------------------------------------
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS postiz_post_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_postiz_post_id
  ON content_items (postiz_post_id) WHERE postiz_post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_postiz_post_id
  ON posts (postiz_post_id) WHERE postiz_post_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- leads: requeue flag + cadence fields for follow-up sweep
-- ---------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS available_for_requeue BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_step INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_response_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_sequence_key TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_requeue
  ON leads (available_for_requeue, temperature)
  WHERE available_for_requeue = true;

CREATE INDEX IF NOT EXISTS idx_leads_follow_up
  ON leads (next_follow_up_at)
  WHERE status IN ('new', 'contacted', 'qualified') AND next_follow_up_at IS NOT NULL;

COMMENT ON COLUMN leads.available_for_requeue IS
  'Nurture/non-buyer flag: queryable so future campaigns (Agent 1 targeting) can pull warm-unconverted leads. Never abandon without a path back.';

-- ---------------------------------------------------------------------------
-- message_templates — human-approved sales copy library only
-- Agent 4 may only send messages that resolve to an approved template.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT NOT NULL UNIQUE,   -- discovery_invite | follow_up_1 | ...
  name            TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN (
                    'whatsapp', 'email', 'sms', 'ghl_automation', 'call_script'
                  )),
  subject         TEXT,                   -- email only
  body            TEXT NOT NULL,          -- may include {{name}} {{campaign_name}} merge fields
  ghl_workflow_id TEXT,                   -- optional: prefer GHL workflow over raw send
  sequence_order  INT NOT NULL DEFAULT 0,
  sequence_key    TEXT NOT NULL DEFAULT 'default_sales',  -- sequence group
  days_after_prev INT NOT NULL DEFAULT 2, -- cadence for follow-up sweep
  language        TEXT NOT NULL DEFAULT 'en',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                    'draft', 'pending_approval', 'approved', 'retired'
                  )),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_templates_seq
  ON message_templates (sequence_key, sequence_order)
  WHERE status = 'approved';

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sales_reports — weekly digests (dashboard + optional Slack/email)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  campaign_id     UUID REFERENCES campaigns (id) ON DELETE SET NULL, -- null = all campaigns
  won_count       INT NOT NULL DEFAULT 0,
  lost_count      INT NOT NULL DEFAULT 0,
  nurture_count   INT NOT NULL DEFAULT 0,
  in_progress     INT NOT NULL DEFAULT 0,
  revenue_won     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  revenue_target  NUMERIC(14, 2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  report_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered_to    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{channel, target, at}]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_reports_period ON sales_reports (period_end DESC);

-- ---------------------------------------------------------------------------
-- Expand sales_activities for template audit ("why did we say X")
-- ---------------------------------------------------------------------------
ALTER TABLE sales_activities
  ADD COLUMN IF NOT EXISTS template_key TEXT,
  ADD COLUMN IF NOT EXISTS template_version INT,
  ADD COLUMN IF NOT EXISTS rendered_body TEXT,
  ADD COLUMN IF NOT EXISTS external_message_id TEXT;

-- Allow activity types used in closed/report flows if check constraint blocks them
-- Recreate check loosely via drop/add (Postgres)
DO $$
BEGIN
  ALTER TABLE sales_activities DROP CONSTRAINT IF EXISTS sales_activities_activity_type_check;
  ALTER TABLE sales_activities ADD CONSTRAINT sales_activities_activity_type_check
    CHECK (activity_type IN (
      'outreach', 'follow_up', 'meeting', 'purchase', 'lost',
      'nurture_requeue', 'classification', 'report', 'template_blocked'
    ));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'sales_activities constraint refresh skipped: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- workflow_failure_counters — repeated failure alerting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_failure_counters (
  workflow_name   TEXT PRIMARY KEY,
  failure_count   INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  last_failed_at  TIMESTAMPTZ,
  alerted_at      TIMESTAMPTZ,
  reset_at        TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- View: warm unconverted leads for future campaigns (Agent 1 targeting input)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_leads_available_for_requeue AS
SELECT
  l.id AS lead_id,
  l.campaign_id AS source_campaign_id,
  c.name AS source_campaign_name,
  c.product_type,
  l.name,
  l.contact_email,
  l.contact_phone,
  l.temperature,
  l.status,
  l.last_touch_at,
  l.created_at
FROM leads l
JOIN campaigns c ON c.id = l.campaign_id
WHERE l.available_for_requeue = true
  AND l.status IN ('nurture', 'lost')
  AND l.status IS DISTINCT FROM 'won'
ORDER BY l.temperature DESC, l.last_touch_at DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- View: latest sales report for dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_latest_sales_report AS
SELECT *
FROM sales_reports
ORDER BY created_at DESC
LIMIT 1;

COMMENT ON TABLE message_templates IS
  'Human-approved sales message library. Agent 4 must not freelance copy — only approved templates/sequences.';
