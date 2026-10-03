-- =============================================================================
-- 007 — Future departments registry (INACTIVE by default, Phase C)
-- No business logic. All rows inactive/disabled. Activation is explicit:
--   UPDATE departments SET status='staging' WHERE dept_key='finance';
-- then staging dry-run, then 'production' per docs/ROADMAP_DEPARTMENTS.md.
-- Safe re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================

CREATE TABLE IF NOT EXISTS departments (
  dept_key    TEXT PRIMARY KEY,  -- finance | people | logistics | security | legal
  display     TEXT NOT NULL,
  owner       TEXT NOT NULL DEFAULT 'human',  -- human remains approver
  status      TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','staging','production')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS department_skills (
  dept_key       TEXT NOT NULL REFERENCES departments (dept_key) ON DELETE CASCADE,
  skill_key      TEXT NOT NULL,  -- e.g. finance:unit-economics
  reference_path TEXT NOT NULL,  -- n8n/prompts/reference/headcount-future/...
  status         TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','staging','active')),
  PRIMARY KEY (dept_key, skill_key)
);

INSERT INTO departments (dept_key, display, owner, status) VALUES
  ('finance',   'Finance',            'human', 'inactive'),
  ('people',    'People / HR',        'human', 'inactive'),
  ('logistics', 'Logistics / Ops',    'human', 'inactive'),
  ('security',  'Security (reviewer)','human', 'inactive'),
  ('legal',     'Legal & Risk (reviewer)','human', 'inactive')
ON CONFLICT (dept_key) DO NOTHING;

INSERT INTO department_skills (dept_key, skill_key, reference_path, status) VALUES
  ('finance',   'finance:unit-economics',            'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('finance',   'finance:budgeting-and-forecasting', 'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('people',    'people:hiring-and-interviewing',    'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('people',    'people:onboarding-and-offboarding', 'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('logistics', 'operations:procurement-and-sourcing','n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('logistics', 'operations:vendor-management',      'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('logistics', 'operations:capacity-and-demand-planning','n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('security',  'security:threat-modeling',          'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled'),
  ('legal',     'legal-risk:contract-review',        'n8n/prompts/reference/headcount-future/00-overview.md', 'disabled')
ON CONFLICT (dept_key, skill_key) DO NOTHING;

-- Verify:
-- SELECT * FROM departments ORDER BY dept_key;
-- SELECT dept_key, count(*) FROM department_skills GROUP BY 1 ORDER BY 1;
