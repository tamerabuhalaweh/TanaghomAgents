BEGIN;

INSERT INTO tanaghom.app_users (id, email, display_name, kind, role, auth_subject)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'owner@example.test',
  'Staging Owner',
  'human',
  'owner',
  '90000000-0000-4000-8000-000000000001'
);

INSERT INTO tanaghom.agents (id, code, name, description)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'campaign_strategist', 'Campaign Strategist', 'Builds structured campaign strategy.'),
  ('10000000-0000-4000-8000-000000000002', 'content_producer', 'Content Producer', 'Creates content drafts for approval.'),
  ('10000000-0000-4000-8000-000000000003', 'publisher_monitor', 'Publisher & Performance Monitor', 'Publishes approved content and records performance.'),
  ('10000000-0000-4000-8000-000000000004', 'sales_crm', 'Sales & CRM Agent', 'Runs bounded lead and sales workflows.');

INSERT INTO tanaghom.campaigns (
  id, name, brief, product_type, target_audience, budget_target,
  revenue_target, currency, created_by
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  'Staging Summer Camp',
  'Safe fixture campaign. It must never publish or contact a real person.',
  'camp',
  '{"age_range":"20-29","geographies":["Egypt","KSA","UAE"],"staging":true}',
  0,
  0,
  'USD',
  '00000000-0000-4000-8000-000000000001'
);

COMMIT;
