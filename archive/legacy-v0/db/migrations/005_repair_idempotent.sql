-- =============================================================================
-- 005 — Idempotent repair / completion check for Supabase
-- Safe to run even if 001–004 partially applied.
-- Does NOT drop data. Use when you see "relation already exists".
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core tables (only create if missing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  brief           TEXT,
  product_type    TEXT NOT NULL,
  target_audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'draft',
  blocked_reason  TEXT,
  budget_target   NUMERIC(14, 2),
  revenue_target  NUMERIC(14, 2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  is_staging      BOOLEAN NOT NULL DEFAULT true,
  environment     TEXT NOT NULL DEFAULT 'staging',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_strategies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  positioning     TEXT NOT NULL,
  key_messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  channels        JSONB NOT NULL DEFAULT '[]'::jsonb,
  posting_cadence JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_pillars JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_strategy    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

CREATE TABLE IF NOT EXISTS content_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  strategy_id      UUID REFERENCES campaign_strategies (id) ON DELETE SET NULL,
  channel          TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  content_pillar   TEXT,
  draft_copy       TEXT NOT NULL,
  media_brief      TEXT,
  media_url        TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  parent_item_id   UUID REFERENCES content_items (id) ON DELETE SET NULL,
  postiz_post_id   TEXT,
  scheduled_time   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  campaign_id     UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  postiz_post_id  TEXT,
  channel         TEXT NOT NULL,
  posted_at       TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  impressions     INT NOT NULL DEFAULT 0,
  engagement_rate NUMERIC(8, 4) NOT NULL DEFAULT 0,
  clicks          INT NOT NULL DEFAULT 0,
  spend           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sync_failures   INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_item_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  source_post_id UUID REFERENCES posts (id) ON DELETE SET NULL,
  name           TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  ghl_contact_id TEXT,
  status         TEXT NOT NULL DEFAULT 'new',
  temperature    TEXT NOT NULL DEFAULT 'warm',
  available_for_requeue BOOLEAN NOT NULL DEFAULT false,
  next_follow_up_at     TIMESTAMPTZ,
  follow_up_step        INT NOT NULL DEFAULT 0,
  no_response_days      INT NOT NULL DEFAULT 0,
  closed_at             TIMESTAMPTZ,
  revenue_amount        NUMERIC(14, 2),
  last_inbound_at       TIMESTAMPTZ,
  template_sequence_key TEXT DEFAULT 'default_sales',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_touch_at  TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  channel       TEXT,
  notes         TEXT,
  outcome       TEXT,
  payload       JSONB,
  template_key  TEXT,
  template_version INT,
  rendered_body TEXT,
  external_message_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_actions_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  result      TEXT NOT NULL,
  error_message TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_integrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel               TEXT NOT NULL UNIQUE,
  postiz_integration_id TEXT NOT NULL,
  postiz_settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_agent TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS message_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  channel         TEXT NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  ghl_workflow_id TEXT,
  sequence_order  INT NOT NULL DEFAULT 0,
  sequence_key    TEXT NOT NULL DEFAULT 'default_sales',
  days_after_prev INT NOT NULL DEFAULT 2,
  language        TEXT NOT NULL DEFAULT 'en',
  status          TEXT NOT NULL DEFAULT 'draft',
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  campaign_id     UUID REFERENCES campaigns (id) ON DELETE SET NULL,
  won_count       INT NOT NULL DEFAULT 0,
  lost_count      INT NOT NULL DEFAULT 0,
  nurture_count   INT NOT NULL DEFAULT 0,
  in_progress     INT NOT NULL DEFAULT 0,
  revenue_won     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  revenue_target  NUMERIC(14, 2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  report_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered_to    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_failure_counters (
  workflow_name   TEXT PRIMARY KEY,
  failure_count   INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  last_failed_at  TIMESTAMPTZ,
  alerted_at      TIMESTAMPTZ,
  reset_at        TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Additive columns (001 may have been an older version without these)
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_staging BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'staging';

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_pillar TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS parent_item_id UUID;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS postiz_post_id TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS strategy_id UUID;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE posts ADD COLUMN IF NOT EXISTS sync_failures INT NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS available_for_requeue BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_step INT NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS no_response_days INT NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(14, 2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS template_sequence_key TEXT DEFAULT 'default_sales';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;

ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS template_key TEXT;
ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS template_version INT;
ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS rendered_body TEXT;
ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS external_message_id TEXT;
ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS payload JSONB;

ALTER TABLE campaign_strategies ADD COLUMN IF NOT EXISTS raw_strategy JSONB;

-- ---------------------------------------------------------------------------
-- Indexes (IF NOT EXISTS)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_environment ON campaigns (environment);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items (status);
CREATE INDEX IF NOT EXISTS idx_content_items_campaign ON content_items (campaign_id);
CREATE INDEX IF NOT EXISTS idx_content_items_pending ON content_items (status) WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_campaign ON posts (campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads (campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_requeue ON leads (available_for_requeue, temperature) WHERE available_for_requeue = true;
CREATE INDEX IF NOT EXISTS idx_agent_actions_log_agent ON agent_actions_log (agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_log_created ON agent_actions_log (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_postiz_post_id ON content_items (postiz_post_id) WHERE postiz_post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_postiz_post_id ON posts (postiz_post_id) WHERE postiz_post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_campaign ON leads (campaign_id, lower(contact_email)) WHERE contact_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helper function + triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_agent_action(
  p_agent_name  TEXT,
  p_action_type TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_payload     JSONB DEFAULT '{}'::jsonb,
  p_result      TEXT DEFAULT 'success',
  p_error       TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO agent_actions_log (
    agent_name, action_type, entity_type, entity_id, payload, result, error_message
  ) VALUES (
    p_agent_name, p_action_type, p_entity_type, p_entity_id, p_payload, p_result, p_error
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_content_items_updated_at ON content_items;
CREATE TRIGGER trg_content_items_updated_at
  BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT
  ci.id,
  ci.campaign_id,
  c.name AS campaign_name,
  c.product_type,
  ci.channel,
  ci.content_type,
  ci.content_pillar,
  ci.draft_copy,
  ci.media_brief,
  ci.media_url,
  ci.scheduled_time,
  ci.rejection_reason,
  ci.parent_item_id,
  ci.created_at
FROM content_items ci
JOIN campaigns c ON c.id = ci.campaign_id
WHERE ci.status = 'pending_approval'
ORDER BY ci.created_at ASC;

CREATE OR REPLACE VIEW v_campaign_pipeline AS
SELECT
  c.id,
  c.name,
  c.status,
  c.product_type,
  c.budget_target,
  c.revenue_target,
  c.currency,
  (SELECT count(*) FROM content_items ci WHERE ci.campaign_id = c.id) AS content_total,
  (SELECT count(*) FROM content_items ci WHERE ci.campaign_id = c.id AND ci.status = 'pending_approval') AS content_pending,
  (SELECT count(*) FROM content_items ci WHERE ci.campaign_id = c.id AND ci.status = 'approved') AS content_approved,
  (SELECT count(*) FROM content_items ci WHERE ci.campaign_id = c.id AND ci.status = 'posted') AS content_posted,
  (SELECT count(*) FROM leads l WHERE l.campaign_id = c.id) AS leads_total,
  (SELECT count(*) FROM leads l WHERE l.campaign_id = c.id AND l.status = 'won') AS leads_won,
  c.created_at,
  c.updated_at
FROM campaigns c
ORDER BY c.created_at DESC;

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
ORDER BY l.temperature DESC, l.last_touch_at DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- Seed templates (only if empty / missing keys)
-- ---------------------------------------------------------------------------
INSERT INTO message_templates (
  template_key, name, channel, subject, body, sequence_key, sequence_order, days_after_prev, language, status
) VALUES
(
  'discovery_invite',
  'First touch — discovery invite',
  'whatsapp',
  NULL,
  E'Hi {{name}} 👋\n\nThanks for your interest in *{{campaign_name}}*.\n\nI''d love to share how the program works and answer any questions — no pressure.\n\nWould a 15-min call this week work for you?\n\n— Team',
  'default_sales', 1, 0, 'en', 'pending_approval'
),
(
  'follow_up_1',
  'Follow-up 1 — value + soft CTA',
  'whatsapp',
  NULL,
  E'Hi {{name}}, just checking in.\n\nPeople who join {{campaign_name}} usually want clarity + community — happy to walk you through dates and what''s included.\n\nReply YES and I''ll send the next steps.',
  'default_sales', 2, 2, 'en', 'pending_approval'
),
(
  'follow_up_2',
  'Follow-up 2 — scarcity only if brief allows',
  'whatsapp',
  NULL,
  E'Hi {{name}} — last note from me for now.\n\nSeats for {{campaign_name}} are limited. If timing isn''t right, I can keep you on the interest list for the next cohort.\n\nWant details or prefer to pause?',
  'default_sales', 3, 3, 'en', 'pending_approval'
),
(
  'nurture_drip',
  'Nurture — stay in touch',
  'email',
  'Staying in touch — {{campaign_name}}',
  E'Hi {{name}},\n\nNo hard sell — just keeping the door open for {{campaign_name}} and future programs.\n\nWhen you''re ready, reply to this email or book a call from our site.\n\nWarmly,\nTeam',
  'default_sales', 4, 7, 'en', 'pending_approval'
),
(
  'close_seat',
  'Close — deposit / booking link',
  'whatsapp',
  NULL,
  E'Great news {{name}} 🎉\n\nHere''s how to reserve your seat for {{campaign_name}}:\n{{booking_link}}\n\nReply if you need help with payment or dates.',
  'default_sales', 5, 1, 'en', 'pending_approval'
),
(
  'meeting_booked_confirm',
  'Meeting booked confirmation',
  'email',
  'You''re booked — {{campaign_name}} discovery call',
  E'Hi {{name}},\n\nYour discovery call for {{campaign_name}} is confirmed.\n\nIf you need to reschedule, just reply to this email.\n\nSee you soon,\nTeam',
  'default_sales', 6, 0, 'en', 'pending_approval'
)
ON CONFLICT (template_key) DO NOTHING;

-- Optional channel placeholders
INSERT INTO channel_integrations (channel, postiz_integration_id, postiz_settings, is_active)
VALUES
  ('instagram', 'REPLACE_WITH_POSTIZ_IG_ID', '{"__type":"instagram","post_type":"post"}'::jsonb, false),
  ('tiktok',    'REPLACE_WITH_POSTIZ_TT_ID', '{"__type":"tiktok"}'::jsonb, false),
  ('facebook',  'REPLACE_WITH_POSTIZ_FB_ID', '{"__type":"facebook"}'::jsonb, false),
  ('linkedin',  'REPLACE_WITH_POSTIZ_LI_ID', '{"__type":"linkedin"}'::jsonb, false)
ON CONFLICT (channel) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification report (what you should see after Run)
-- ---------------------------------------------------------------------------
SELECT 'tables' AS check_type, count(*)::text AS value
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'campaigns','campaign_strategies','content_items','posts','leads',
    'sales_activities','agent_actions_log','channel_integrations','event_outbox',
    'message_templates','sales_reports','workflow_failure_counters'
  )
UNION ALL
SELECT 'message_templates_rows', count(*)::text FROM message_templates
UNION ALL
SELECT 'views', count(*)::text
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('v_pending_approvals','v_campaign_pipeline','v_leads_available_for_requeue');
