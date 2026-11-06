# Reference 06 — Lifecycle Messaging (adapted for Groky Agent 4 sequences)

> Source: https://github.com/cbrock84/headcount/blob/main/plugins/demand-generation/skills/lifecycle-messaging/SKILL.md
> License: MIT © Chris Brock. Adapted.
> Groky use: `message_templates` sequences (`default_sales`), Agent 4 sweep cadence, `days_after_prev`.
> Guards (NON-NEGOTIABLE): approved templates only, merge-fields only, dry-run in staging, every touch → `sales_activities`, template_blocked if none approved.

## Lifecycle before copy
Per stage name what person tries to do + what moves them forward. Without it → announcements → unsubscribes.
Stages: just-signed-up, activated-not-habitual, habitual, at-risk, lapsed. Over-invest first, neglect at-risk (where money is) — Groky: do NOT neglect at-risk/nurture.

## Welcome (highest engagement ever — no company history)
1. Immediate — deliver promised + single next action.
2. Within days — fastest route to first value, one step.
3. After — most-missed use case or top objection.
Set expectations early (what + how often) — reduces unsubscribes more than subject tricks.

## Timing
Trigger on behavior, not calendar (did-something >> it's-Tuesday). Cadence sustainable at worst week. Every message must be missable-worthy.

## SMS discipline (Groky whatsapp/sms)
Higher consent/intrusion/cost. Reserve for time-sensitive/transactional (delivery, appointment, expiring window). Marketing SMS at volume trains opt-out.
- Express written consent before marketing SMS (US); implied/customer-relationship/collected-for-other-purpose ≠ consent. Disclose purpose/frequency/rates at consent. Honor opt-out immediately on every keyword (one confirmation, then silence). Quiet hours in RECIPIENT tz. Retain consent/opt-out records (entire defense). Never buy/rent lists. Other jurisdictions may be stricter — check recipient location. Consult counsel — statutory damages per message.

## Subject + preview (email)
One unit, read together. Preview extends subject, never echoes, never defaults to body first line.

## Diagnose
Low open → reputation/list/deliverability BEFORE copy. Open-no-click → subject undelivered or no single action. Click-no-convert → destination, not email. Rising unsub → frequency/relevance (usually frequency).

## Tooling note for Groky
Marketing vs transactional reputation separated (separate domains/senders). Groky: prefer GHL workflows bound to approved templates; keep `ghl_workflow_id` on template row.
