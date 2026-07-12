-- Combined migrations for Supabase SQL Editor
-- Paste entire file and Run. Safe-ish on fresh project; 003 uses IF NOT EXISTS.

-- ========== 001_init_schema.sql ==========
-- =============================================================================
-- Content-to-Sales Multi-Agent System â€” Postgres schema
-- System of record for all n8n agents. No agent holds state in memory.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- campaigns â€” top-level unit of work
-- ---------------------------------------------------------------------------
CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  brief           TEXT,
  product_type    TEXT NOT NULL CHECK (product_type IN (
                    'camp', 'book', 'coaching_program', 'course'
                  )),
  target_audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                    'draft',
                    'blocked_missing_info',
                    'strategy_ready',
                    'content_in_progress',
                    'active',
                    'closed'
                  )),
  blocked_reason  TEXT,
  budget_target   NUMERIC(14, 2),
  revenue_target  NUMERIC(14, 2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  is_staging      BOOLEAN NOT NULL DEFAULT true,   -- default staging: no real spend/leads until flipped
  environment     TEXT NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging', 'production')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_status ON campaigns (status);
CREATE INDEX idx_campaigns_created_at ON campaigns (created_at DESC);

-- ---------------------------------------------------------------------------
-- campaign_strategies â€” Agent 1 output (structured, not freeform prose)
-- ---------------------------------------------------------------------------
CREATE TABLE campaign_strategies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  positioning     TEXT NOT NULL,
  key_messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  channels        JSONB NOT NULL DEFAULT '[]'::jsonb,
  posting_cadence JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_pillars JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_strategy    JSONB,              -- full LLM JSON payload for audit/debug
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)                -- one active strategy per campaign (v1)
);

CREATE INDEX idx_campaign_strategies_campaign ON campaign_strategies (campaign_id);

-- ---------------------------------------------------------------------------
-- content_items â€” Agent 2 output; human approval gate lives here
-- ---------------------------------------------------------------------------
CREATE TABLE content_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  strategy_id      UUID REFERENCES campaign_strategies (id) ON DELETE SET NULL,
  channel          TEXT NOT NULL,
  content_type     TEXT NOT NULL CHECK (content_type IN (
                     'post', 'reel_script', 'ad_copy', 'email'
                   )),
  content_pillar   TEXT,
  draft_copy       TEXT NOT NULL,
  media_brief      TEXT,
  media_url        TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                     'draft',
                     'pending_approval',
                     'approved',
                     'rejected',
                     'posted'
                   )),
  rejection_reason TEXT,
  parent_item_id   UUID REFERENCES content_items (id) ON DELETE SET NULL, -- regeneration chain
  postiz_post_id   TEXT,               -- denormalized for idempotency checks before re-publish
  scheduled_time   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ
);

CREATE INDEX idx_content_items_status ON content_items (status);
CREATE INDEX idx_content_items_campaign ON content_items (campaign_id);
CREATE INDEX idx_content_items_pending ON content_items (status) WHERE status = 'pending_approval';
CREATE INDEX idx_content_items_approved_scheduled ON content_items (scheduled_time)
  WHERE status = 'approved';

-- ---------------------------------------------------------------------------
-- posts â€” Agent 3 publishing + performance
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  campaign_id     UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  postiz_post_id  TEXT,
  channel         TEXT NOT NULL,
  posted_at       TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
                    'scheduled', 'live', 'failed', 'deleted'
                  )),
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

CREATE INDEX idx_posts_status ON posts (status);
CREATE INDEX idx_posts_live ON posts (status) WHERE status = 'live';
CREATE INDEX idx_posts_campaign ON posts (campaign_id);

-- ---------------------------------------------------------------------------
-- leads â€” captured from posts/ads
-- ---------------------------------------------------------------------------
CREATE TABLE leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  source_post_id UUID REFERENCES posts (id) ON DELETE SET NULL,
  name           TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  ghl_contact_id TEXT,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                   'new', 'contacted', 'qualified', 'won', 'lost', 'nurture'
                 )),
  temperature    TEXT NOT NULL DEFAULT 'warm' CHECK (temperature IN (
                   'hot', 'warm', 'cold'
                 )),
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

CREATE INDEX idx_leads_status ON leads (status);
CREATE INDEX idx_leads_campaign ON leads (campaign_id);
CREATE INDEX idx_leads_new ON leads (status) WHERE status = 'new';
CREATE UNIQUE INDEX idx_leads_email_campaign
  ON leads (campaign_id, lower(contact_email))
  WHERE contact_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sales_activities â€” sales cycle audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE sales_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
                  'outreach', 'follow_up', 'meeting', 'purchase', 'lost', 'nurture_requeue'
                )),
  channel       TEXT CHECK (channel IN (
                  'whatsapp', 'email', 'call', 'sms', 'ghl_automation', 'system'
                )),
  notes         TEXT,
  outcome       TEXT,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_activities_lead ON sales_activities (lead_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- agent_actions_log â€” immutable audit log (every meaningful action)
-- ---------------------------------------------------------------------------
CREATE TABLE agent_actions_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  result      TEXT NOT NULL CHECK (result IN (
                'success', 'failed', 'blocked_pending_approval', 'blocked_missing_info', 'skipped'
              )),
  error_message TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_actions_log_agent ON agent_actions_log (agent_name, created_at DESC);
CREATE INDEX idx_agent_actions_log_entity ON agent_actions_log (entity_type, entity_id);
CREATE INDEX idx_agent_actions_log_created ON agent_actions_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- channel_integrations â€” maps internal channel names â†’ Postiz integration IDs
-- ---------------------------------------------------------------------------
CREATE TABLE channel_integrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel               TEXT NOT NULL UNIQUE,  -- instagram | tiktok | facebook | etc.
  postiz_integration_id TEXT NOT NULL,
  postiz_settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- outbound_webhooks â€” optional queue if you prefer DB-driven handoffs
-- ---------------------------------------------------------------------------
CREATE TABLE event_outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_agent TEXT,              -- agent_2 | agent_3 | agent_4 | null
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                 'pending', 'delivered', 'failed'
               )),
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_event_outbox_pending ON event_outbox (status, created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_content_items_updated_at
  BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: log agent action (callable from SQL / RPC)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Views for dashboard / ops
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

COMMENT ON TABLE agent_actions_log IS
  'Immutable audit trail. Every agent writes here on every meaningful action. No silent actions.';
COMMENT ON TABLE content_items IS
  'Human approval is the only path to status=approved. Agent 3 must re-check DB before posting.';


-- ========== 002_seed_example.sql ==========
-- Optional seed for local dev / demo. Safe to re-run with ON CONFLICT where applicable.
-- Does NOT create live integrations â€” fill channel_integrations after connecting Postiz.

INSERT INTO channel_integrations (channel, postiz_integration_id, postiz_settings, is_active)
VALUES
  ('instagram', 'REPLACE_WITH_POSTIZ_IG_ID', '{"__type":"instagram","post_type":"post"}'::jsonb, false),
  ('tiktok',    'REPLACE_WITH_POSTIZ_TT_ID', '{"__type":"tiktok","privacy_level":"PUBLIC_TO_EVERYONE","duet":false,"stitch":false,"comment":true,"autoAddMusic":false,"brand_content_toggle":false,"brand_organic_toggle":false,"content_posting_method":"DIRECT_POST"}'::jsonb, false),
  ('facebook',  'REPLACE_WITH_POSTIZ_FB_ID', '{"__type":"facebook"}'::jsonb, false),
  ('linkedin',  'REPLACE_WITH_POSTIZ_LI_ID', '{"__type":"linkedin"}'::jsonb, false)
ON CONFLICT (channel) DO NOTHING;

-- Example draft campaign (Agent 1 will process when status=draft webhook fires)
INSERT INTO campaigns (
  id, name, brief, product_type, target_audience,
  status, budget_target, revenue_target, currency
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Summer Camp 2026 â€” Youth GCC/Egypt',
  $$Transformational 7-day life camp for young adults who feel stuck.
Product: residential summer camp (coaching + community + outdoor challenges).
Offer: Early-bird deposit $299, full program $1,499.
CTA: Book discovery call / reserve seat.
Tone: bold, hopeful, peer-language â€” not corporate.
Must mention: limited seats, Egypt/KSA/UAE cohorts.$$,
  'camp',
  '{
    "age_min": 20,
    "age_max": 29,
    "geographies": ["Egypt", "KSA", "UAE"],
    "interests": ["personal growth", "community", "career clarity", "faith-friendly wellness"],
    "languages": ["ar", "en"]
  }'::jsonb,
  'draft',
  15000,
  75000,
  'USD'
) ON CONFLICT (id) DO NOTHING;


-- ========== 003_agent4_ops.sql ==========
-- =============================================================================
-- 003 â€” Agent 4 + ops hardening (templates, requeue, reports, staging, idempotency)
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
-- message_templates â€” human-approved sales copy library only
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
-- sales_reports â€” weekly digests (dashboard + optional Slack/email)
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
-- workflow_failure_counters â€” repeated failure alerting
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
  'Human-approved sales message library. Agent 4 must not freelance copy â€” only approved templates/sequences.';


-- ========== 004_seed_message_templates.sql ==========
-- Seed sales sequence templates as DRAFT / pending_approval.
-- Agent 4 will NOT send these until status = 'approved' (human checkpoint).
-- Review body copy, then:
--   UPDATE message_templates SET status='approved', approved_by='you', approved_at=now()
--   WHERE sequence_key = 'default_sales';

INSERT INTO message_templates (
  template_key, name, channel, subject, body, sequence_key, sequence_order, days_after_prev, language, status
) VALUES
(
  'discovery_invite',
  'First touch â€” discovery invite',
  'whatsapp',
  NULL,
  E'Hi {{name}} ðŸ‘‹\n\nThanks for your interest in *{{campaign_name}}*.\n\nI''d love to share how the program works and answer any questions â€” no pressure.\n\nWould a 15-min call this week work for you?\n\nâ€” Team',
  'default_sales',
  1,
  0,
  'en',
  'pending_approval'
),
(
  'follow_up_1',
  'Follow-up 1 â€” value + soft CTA',
  'whatsapp',
  NULL,
  E'Hi {{name}}, just checking in.\n\nPeople who join {{campaign_name}} usually want clarity + community â€” happy to walk you through dates and what''s included.\n\nReply YES and I''ll send the next steps.',
  'default_sales',
  2,
  2,
  'en',
  'pending_approval'
),
(
  'follow_up_2',
  'Follow-up 2 â€” scarcity only if brief allows',
  'whatsapp',
  NULL,
  E'Hi {{name}} â€” last note from me for now.\n\nSeats for {{campaign_name}} are limited. If timing isn''t right, I can keep you on the interest list for the next cohort.\n\nWant details or prefer to pause?',
  'default_sales',
  3,
  3,
  'en',
  'pending_approval'
),
(
  'nurture_drip',
  'Nurture â€” stay in touch',
  'email',
  'Staying in touch â€” {{campaign_name}}',
  E'Hi {{name}},\n\nNo hard sell â€” just keeping the door open for {{campaign_name}} and future programs.\n\nWhen you''re ready, reply to this email or book a call from our site.\n\nWarmly,\nTeam',
  'default_sales',
  4,
  7,
  'en',
  'pending_approval'
),
(
  'close_seat',
  'Close â€” deposit / booking link',
  'whatsapp',
  NULL,
  E'Great news {{name}} ðŸŽ‰\n\nHere''s how to reserve your seat for {{campaign_name}}:\n{{booking_link}}\n\nReply if you need help with payment or dates.',
  'default_sales',
  5,
  1,
  'en',
  'pending_approval'
),
(
  'meeting_booked_confirm',
  'Meeting booked confirmation',
  'email',
  'You''re booked â€” {{campaign_name}} discovery call',
  E'Hi {{name}},\n\nYour discovery call for {{campaign_name}} is confirmed.\n\nIf you need to reschedule, just reply to this email.\n\nSee you soon,\nTeam',
  'default_sales',
  6,
  0,
  'en',
  'pending_approval'
)
ON CONFLICT (template_key) DO NOTHING;
