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
  'First touch — discovery invite',
  'whatsapp',
  NULL,
  E'Hi {{name}} 👋\n\nThanks for your interest in *{{campaign_name}}*.\n\nI''d love to share how the program works and answer any questions — no pressure.\n\nWould a 15-min call this week work for you?\n\n— Team',
  'default_sales',
  1,
  0,
  'en',
  'pending_approval'
),
(
  'follow_up_1',
  'Follow-up 1 — value + soft CTA',
  'whatsapp',
  NULL,
  E'Hi {{name}}, just checking in.\n\nPeople who join {{campaign_name}} usually want clarity + community — happy to walk you through dates and what''s included.\n\nReply YES and I''ll send the next steps.',
  'default_sales',
  2,
  2,
  'en',
  'pending_approval'
),
(
  'follow_up_2',
  'Follow-up 2 — scarcity only if brief allows',
  'whatsapp',
  NULL,
  E'Hi {{name}} — last note from me for now.\n\nSeats for {{campaign_name}} are limited. If timing isn''t right, I can keep you on the interest list for the next cohort.\n\nWant details or prefer to pause?',
  'default_sales',
  3,
  3,
  'en',
  'pending_approval'
),
(
  'nurture_drip',
  'Nurture — stay in touch',
  'email',
  'Staying in touch — {{campaign_name}}',
  E'Hi {{name}},\n\nNo hard sell — just keeping the door open for {{campaign_name}} and future programs.\n\nWhen you''re ready, reply to this email or book a call from our site.\n\nWarmly,\nTeam',
  'default_sales',
  4,
  7,
  'en',
  'pending_approval'
),
(
  'close_seat',
  'Close — deposit / booking link',
  'whatsapp',
  NULL,
  E'Great news {{name}} 🎉\n\nHere''s how to reserve your seat for {{campaign_name}}:\n{{booking_link}}\n\nReply if you need help with payment or dates.',
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
  'You''re booked — {{campaign_name}} discovery call',
  E'Hi {{name}},\n\nYour discovery call for {{campaign_name}} is confirmed.\n\nIf you need to reschedule, just reply to this email.\n\nSee you soon,\nTeam',
  'default_sales',
  6,
  0,
  'en',
  'pending_approval'
)
ON CONFLICT (template_key) DO NOTHING;
