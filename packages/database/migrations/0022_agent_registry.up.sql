BEGIN;

CREATE TABLE tanaghom.agent_role_registry (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 120),
  short_name text NOT NULL CHECK (length(trim(short_name)) BETWEEN 2 AND 40),
  responsibility text NOT NULL CHECK (length(trim(responsibility)) BETWEEN 20 AND 1000),
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0),
  contract_version text NOT NULL DEFAULT 'tanaghom.agent-registry.v1'
    CHECK (contract_version = 'tanaghom.agent-registry.v1'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE tanaghom.agent_workflow_registry (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  role_code text NOT NULL REFERENCES tanaghom.agent_role_registry(code) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 160),
  responsibility text NOT NULL CHECK (length(trim(responsibility)) BETWEEN 20 AND 1000),
  phase text NOT NULL CHECK (length(trim(phase)) BETWEEN 3 AND 40),
  workflow_name text NOT NULL UNIQUE CHECK (length(trim(workflow_name)) BETWEEN 3 AND 200),
  workflow_version text NOT NULL CHECK (workflow_version ~ '^v[1-9][0-9]*$'),
  source_path text NOT NULL UNIQUE CHECK (source_path ~ '^n8n/workflows/.+\.json$'),
  job_types text[] NOT NULL CHECK (cardinality(job_types) > 0),
  release_state text NOT NULL CHECK (release_state IN ('available','retired')),
  runtime_state text NOT NULL CHECK (runtime_state IN ('available_not_imported','imported_inactive','active')),
  trigger_state text NOT NULL CHECK (trigger_state IN ('disabled','workflow_inactive_only','enabled')),
  runtime_verified_at timestamptz NOT NULL,
  runtime_evidence text NOT NULL CHECK (length(trim(runtime_evidence)) BETWEEN 3 AND 200),
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0),
  contract_version text NOT NULL DEFAULT 'tanaghom.agent-registry.v1'
    CHECK (contract_version = 'tanaghom.agent-registry.v1'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (runtime_state <> 'active' OR trigger_state IN ('disabled','enabled')),
  CHECK (trigger_state <> 'enabled' OR runtime_state = 'active')
);

CREATE TRIGGER agent_role_registry_updated_at
BEFORE UPDATE ON tanaghom.agent_role_registry
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE TRIGGER agent_workflow_registry_updated_at
BEFORE UPDATE ON tanaghom.agent_workflow_registry
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

INSERT INTO tanaghom.agent_role_registry
  (code,name,short_name,responsibility,display_order)
VALUES
  ('campaign_strategist','Campaign Strategist','Strategy',
    'Turns an approved business brief into positioning, channels, messages, cadence, and measurable campaign direction.',10),
  ('content_producer','Content Producer','Content',
    'Creates channel-specific draft content from the approved strategy and hands every public-facing item to a human reviewer.',20),
  ('publisher_monitor','Publisher & Performance Monitor','Publishing',
    'Creates approved Postiz drafts, observes published performance, and returns attributable results without bypassing human control.',30),
  ('sales_crm','Sales & CRM Agent','Sales',
    'Synchronizes leads, prepares governed CRM actions, supports high-volume conversations, and proves reply quality before autonomy expands.',40);

INSERT INTO tanaghom.agent_workflow_registry
  (code,role_code,name,responsibility,phase,workflow_name,workflow_version,source_path,
   job_types,release_state,runtime_state,trigger_state,runtime_verified_at,runtime_evidence,display_order)
VALUES
  ('campaign_strategy_generator','campaign_strategist','Campaign Strategy Generator',
    'Claims strategy jobs, asks Gemma for a versioned strategy contract, validates it, and persists accepted evidence.',
    'Phase 3','Tanaghom — Campaign Strategist v1','v1','n8n/workflows/phase3/campaign-strategist.v1.json',
    ARRAY['campaign.strategy.generate'],'available','imported_inactive','workflow_inactive_only',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',10),
  ('campaign_content_generator','content_producer','Campaign Content Generator',
    'Claims content jobs, generates validated drafts, records provenance, and stops at the human approval gate.',
    'Phase 3','Tanaghom — Content Producer v1','v1','n8n/workflows/phase3/content-producer.v1.json',
    ARRAY['campaign.content.generate'],'available','imported_inactive','workflow_inactive_only',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',20),
  ('postiz_draft_publisher','publisher_monitor','Postiz Draft Publisher',
    'Revalidates approval immediately before creating a Postiz draft; it has no automatic publish path.',
    'Phase 4','Tanaghom — Postiz Draft Publisher v1','v1','n8n/workflows/phase4/postiz-draft-publisher.v1.json',
    ARRAY['content.postiz.draft'],'available','imported_inactive','disabled',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',30),
  ('postiz_performance_monitor','publisher_monitor','Postiz Performance Monitor',
    'Reads authorized analytics through the private gateway and records normalized performance and attribution evidence.',
    'Phase 4','Tanaghom — Postiz Performance Monitor v1','v1','n8n/workflows/phase4/postiz-performance-monitor.v1.json',
    ARRAY['postiz.performance.sync'],'available','available_not_imported','disabled',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',40),
  ('ghl_contact_sync','sales_crm','GHL Contact Sync',
    'Creates or updates an explicitly queued GHL contact through the private credential gateway.',
    'Phase 5','Tanaghom — GHL Contact Sync v1','v1','n8n/workflows/phase5/ghl-contact-sync.v1.json',
    ARRAY['lead.ghl.contact_upsert'],'available','available_not_imported','disabled',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',50),
  ('governed_ghl_actions','sales_crm','Governed GHL Actions',
    'Executes only database-authorized messages, qualification, booking, pipeline, and ownership actions with policy rechecks.',
    'Phase 5E','Tanaghom — Governed GHL Actions v1','v1','n8n/workflows/phase5/governed-ghl-actions.v1.json',
    ARRAY['ghl.action.execute'],'available','available_not_imported','disabled',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',60),
  ('quality_shadow_evaluator','sales_crm','Quality Shadow Evaluator',
    'Compares proposal-only AI replies with de-identified human baselines and records evidence without taking an external action.',
    'Phase 5G','Tanaghom — Quality Shadow Evaluator v1','v1','n8n/workflows/phase5g/quality-shadow-evaluator.v1.json',
    ARRAY['quality.shadow.evaluate'],'available','imported_inactive','disabled',
    timestamptz '2026-07-19 00:00:00+00','production-audit-after-pr-83',70);

REVOKE ALL ON tanaghom.agent_role_registry,tanaghom.agent_workflow_registry
  FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker,tanaghom_readonly;
GRANT SELECT ON tanaghom.agent_role_registry,tanaghom.agent_workflow_registry
  TO tanaghom_api,tanaghom_readonly;

INSERT INTO public.schema_migrations(version) VALUES ('0022_agent_registry');
COMMIT;
