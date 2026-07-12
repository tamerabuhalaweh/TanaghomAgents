-- Optional seed for local dev / demo. Safe to re-run with ON CONFLICT where applicable.
-- Does NOT create live integrations — fill channel_integrations after connecting Postiz.

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
  'Summer Camp 2026 — Youth GCC/Egypt',
  $$Transformational 7-day life camp for young adults who feel stuck.
Product: residential summer camp (coaching + community + outdoor challenges).
Offer: Early-bird deposit $299, full program $1,499.
CTA: Book discovery call / reserve seat.
Tone: bold, hopeful, peer-language — not corporate.
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
