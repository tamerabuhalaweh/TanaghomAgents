BEGIN;

UPDATE tanaghom.organizations
   SET name = 'Tanaghom Demo Workspace'
 WHERE id = '10000000-0000-4000-8000-000000000001';

INSERT INTO tanaghom.app_users (id, email, display_name, kind, role, auth_subject, accepted_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner@demo.tanaghom.test', 'Demo Owner', 'human', 'owner', '90000000-0000-4000-8000-000000000001', now()),
  ('00000000-0000-4000-8000-000000000011', 'reviewer@demo.tanaghom.test', 'Demo Reviewer', 'human', 'reviewer', '90000000-0000-4000-8000-000000000011', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO tanaghom.campaigns (
  id, name, brief, product_type, target_audience, status,
  budget_target, revenue_target, currency, created_by
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  'Demo Summer Camp',
  'Synthetic demo campaign. It must never contact or publish to a real person.',
  'camp',
  '{"age_range":"20-29","geographies":["Egypt","KSA","UAE"],"demo":true}',
  'awaiting_approval',
  0,
  0,
  'USD',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tanaghom.campaign_strategies (
  id, campaign_id, version, positioning, key_messages, channels,
  posting_cadence, content_pillars, model_name, prompt_version
)
VALUES (
  '21000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1,
  'A safe demo campaign for testing human approval and Creative Studio.',
  '["Practical value","Local relevance"]',
  '["instagram"]',
  '{"instagram":{"posts_per_week":2}}',
  '["education","proof"]',
  'demo-fixture',
  'demo-v1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tanaghom.content_items (
  id, campaign_id, strategy_id, generation, channel, content_type,
  draft_copy, media_brief, status
)
VALUES
  (
    '22000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    1, 'instagram', 'post',
    'Demo draft: A practical summer camp update for local families.',
    'Synthetic demo media brief. No external publishing.',
    'pending_approval'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    2, 'instagram', 'post',
    'مسودة تجريبية: تحديث صيفي عملي للعائلات المحلية.',
    'موجز وسائط تجريبي. لا يوجد نشر خارجي.',
    'pending_approval'
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    3, 'instagram', 'post',
    'Synthetic validation item used only by the local smoke test.',
    'Synthetic validation media brief.',
    'pending_approval'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO tanaghom.brand_kits (
  id, organization_id, name, current_version
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Demo Brand Kit',
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tanaghom.brand_kit_versions (
  id, kit_id, version, colors, typography, arabic_font, latin_font,
  logos, tone, voice_ref, rules, cta, channels, created_by
)
VALUES (
  '31000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  1,
  '{"primary":"#0f766e","secondary":"#f8fafc","accent":"#e2e8f0"}',
  '{"heading":"Inter","body":"Inter"}',
  'Noto Kufi Arabic',
  'Inter',
  '{}',
  'Clear, practical, and human.',
  NULL,
  '{"do":["Keep it simple"],"avoid":["Unsupported claims"]}',
  '{"default":"Learn more"}',
  '{"instagram":true}',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
