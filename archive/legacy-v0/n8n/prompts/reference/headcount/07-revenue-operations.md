# Reference 07 — Revenue Operations (adapted for Groky Agent 4)

> Source: https://github.com/cbrock84/headcount/blob/main/plugins/revenue/skills/revenue-operations/SKILL.md
> License: MIT © Chris Brock. Adapted.
> Groky use: lead lifecycle, handoff Agent3b→4, sweep, `sales_reports`, forecast discipline.
> Guards: Postgres = truth, `ghl_contact_id` idempotency, no freelance copy, audit all.

## Definitions before dashboards (write once, get agreement)
- Lifecycle stage = observable event moving record (not feeling). E.g. "confirmed budget" not "strong interest".
- Qualified = by whose judgment + what evidence.
- Opportunity created = what evidence required.
- Pipeline stage entry = buyer action.
- Closed-lost vs stalled + auto-exit rule for stalled.
- Groky mapping: `new → contacted → qualified → nurture|won|lost`; `temperature hot|warm|cold`. Without defs, numbers negotiable, forecast fiction.

## Handoff (where revenue leaks)
Criteria to pass, SLA first contact, context transferred, route BACK with recorded reason when rejected. No-reason rejection loop = marketing resends same unqualified, both blame other.
Groky: 3b must pass `campaign_id + source_post_id + name/email/phone + temperature`; 4 must log accept/reject with reason in `sales_activities`.

## Scoring (routes attention, not decoration)
If sellers don't change work from score → decoration. Two separate dimensions:
- Fit (static: size/industry/geo/role/seniority/tech) — looks like customer?
- Intent (dynamic, decays: pricing visits, repeats, demo req, depth, outreach response) — acts like buyer now?
Never collapse to one number (perfect-fit-no-activity = poor-fit-browsing, both wrong). Build from closed-won/lost history, not intuition. Decay intent, recalibrate scheduled.
Groky: `temperature` ≈ intent; `product_type`/geo ≈ fit. Keep separate in `leads.notes` + `sales_activities.payload`.

## Forecast
Stage probabilities from YOUR history, recalculated — not defaults. Commit/best-case/pipeline separate. Every forecasted deal has date + next step (neither → not in forecast). Track accuracy by rep — trust + fast improvement.

## Hygiene
Stage-gate required fields, entry validation, scheduled dedupe, auto-age stale. Never require unused field (trains garbage in all).
Groky: `next_follow_up_at`, `follow_up_step`, `no_response_days`, `available_for_requeue` maintained by sweep, not discipline alone. Never two truths — Postgres leads = truth, GHL reads it.

## Return
Gaps found, process change, seller time cost, metric proving it worked.
