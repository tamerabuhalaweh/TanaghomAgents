-- =============================================================================
-- Content-to-Sales Multi-Agent System — Postgres schema
-- System of record for all n8n agents. No agent holds state in memory.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- campaigns — top-level unit of work
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
-- campaign_strategies — Agent 1 output (structured, not freeform prose)
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
-- content_items — Agent 2 output; human approval gate lives here
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
-- posts — Agent 3 publishing + performance
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
-- leads — captured from posts/ads
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
-- sales_activities — sales cycle audit trail
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
-- agent_actions_log — immutable audit log (every meaningful action)
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
-- channel_integrations — maps internal channel names → Postiz integration IDs
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
-- outbound_webhooks — optional queue if you prefer DB-driven handoffs
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
