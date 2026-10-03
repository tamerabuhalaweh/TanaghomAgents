-- =============================================================================
-- 006 — Headcount expansion: Agent 4 sequence extension (pending_approval only)
-- Extends default_sales 6 → 13. Appends tail (orders 7-13), never reorders 1-6,
-- so live approved sequences keep working. All rows pending_approval.
-- Human must approve before Agent 4 sends anything.
-- Merge fields only: {{name}} {{campaign_name}} {{booking_link}}. No discounts invented.
-- Ref: n8n/prompts/reference/headcount/06,07,08 + docs/HEADCOUNT_ATTRIBUTION.md (MIT)
-- =============================================================================

INSERT INTO message_templates (
  template_key, name, channel, subject, body, sequence_key, sequence_order, days_after_prev, language, status
) VALUES
(
  'value_proof',
  'Value — proof + outcome (headcount sales-enablement)',
  'whatsapp',
  NULL,
  E'Hi {{name}} — quick proof point for {{campaign_name}}.\n\nPast participants joined for clarity + community and left with a concrete next step. Happy to share how it maps to your situation.\n\nWant the 2-min version?',
  'default_sales',
  7,
  2,
  'en',
  'pending_approval'
),
(
  'objection_answer',
  'Objection — plain answer (headcount: acknowledge legitimate part first)',
  'whatsapp',
  NULL,
  E'Hi {{name}}, totally fair to think it through.\n\nIf the question is timing/fit for {{campaign_name}}, tell me what would need to be true and I will give you a straight answer — no push.\n\nWhat is top of mind?',
  'default_sales',
  8,
  3,
  'en',
  'pending_approval'
),
(
  'reengagement',
  'Re-engagement — behavior trigger (headcount lifecycle)',
  'email',
  'Still interested in {{campaign_name}}?',
  E'Hi {{name}},\n\nNoticed you checked {{campaign_name}} but we lost touch. If timing was off, reply with what would help (dates, details, call) and I will send exactly that.\n\nNo sequence spam — one helpful reply.\n\nWarmly,\nTeam',
  'default_sales',
  9,
  7,
  'en',
  'pending_approval'
),
(
  'nurture_drip_2',
  'Nurture 2 — at-risk care (headcount: at-risk is where money is)',
  'email',
  'Keeping the door open — {{campaign_name}}',
  E'Hi {{name}},\n\nNo pressure on {{campaign_name}}. When you are ready — next cohort, different program, or just a question — reply here.\n\nIf you want off this list, reply STOP and I will close it immediately.',
  'default_sales',
  10,
  14,
  'en',
  'pending_approval'
),
(
  'final_breakup',
  'Breakup — close loop, keep requeue path',
  'whatsapp',
  NULL,
  E'Hi {{name}} — closing the loop on {{campaign_name}} for now.\n\nI will keep you on the interest list (no messages unless something relevant). Reply START anytime to reopen.\n\nWishing you well — Team',
  'default_sales',
  11,
  7,
  'en',
  'pending_approval'
),
(
  'call_script_discovery',
  'Call script — 15-min discovery (owner-maintained, quarterly review)',
  'call_script',
  NULL,
  E'Opener: Hi {{name}}, thanks for your interest in {{campaign_name}} — 15 min, no pressure, is now still good?\n\n1) What made you look at {{campaign_name}} now? 2) What would need to be true to join? 3) Timing/dates? 4) Next step: book here {{booking_link}} or nurture.\n\nClose: I will send one summary message after this call. Reply STOP to opt out.',
  'default_sales',
  12,
  0,
  'en',
  'pending_approval'
),
(
  'ghl_welcome_automation',
  'GHL automation — welcome binding (prefer workflow over raw send)',
  'ghl_automation',
  NULL,
  E'Hi {{name}} — welcome re {{campaign_name}}. This binds to the approved GHL workflow for welcome + first value. Body stays merge-only; workflow owns timing. Booking: {{booking_link}}.',
  'default_sales',
  13,
  0,
  'en',
  'pending_approval'
)
ON CONFLICT (template_key) DO NOTHING;

-- Verify (Supabase SQL Editor):
-- SELECT sequence_order, template_key, channel, status FROM message_templates WHERE sequence_key='default_sales' ORDER BY sequence_order;
-- Approve when copy reviewed:
-- UPDATE message_templates SET status='approved', approved_by='you', approved_at=now() WHERE sequence_key='default_sales' AND status='pending_approval';
-- Retire (never edit live): UPDATE message_templates SET status='retired' WHERE template_key='old_key';
