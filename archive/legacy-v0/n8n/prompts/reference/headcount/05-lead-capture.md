# Reference 05 — Lead Capture (adapted for Groky intake + 3b + Agent 4)

> Source: https://github.com/cbrock84/headcount/blob/main/plugins/demand-generation/skills/lead-capture/SKILL.md
> License: MIT © Chris Brock. Adapted.
> Groky use: `05_lead_capture_webhook.json` payload discipline + `03b` lead extraction + Agent 4 first-touch routing.
> Guards: `campaign_id + source_post_id` required, attribution preserved, `status=new`, fire Agent 4, audit `lead_capture/ingest_lead`.

## Gate cost
Every gate trades reach for contacts. Gate only when contact > reader value (rarer than assumed).
- Gate: immediate utility buyer uses in evaluation (templates, calculators, assessments, data).
- Never gate: thought leadership, citable/shareable, anything competitor gives open.

## Magnets + free tools
- Test: would someone pay small amount? If no → won't earn used email.
- Best = things people USE (template saving afternoon, calculator, mid-process checklist), not ebooks restating posts.
- Match magnet to stage: beginner guide ≠ sales-call ready (treating so burns list).
- Free tool = strongest (durable, links, qualifies by use). Let them use, ask email to save/export. Gating before value converts fraction.

## Popups/overlays + forms
- Behavior triggers (exit/scroll/second visit), never 3-sec interrupt. Once per visitor, remembered. Never mobile mid-content (penalized).
- Offer specific ("pricing calculator"), not "subscribe". One clear dismissal.
- Every field costs conversion. Ask only next-step need; enrichment fills rest. Explain non-obvious fields (abandon point).

## Groky rule
Form fill ≠ intent. Most wanted asset. Route by fit+intent (see Ref 07), never auto-qualify on fill alone. Preserve `source_post_id` for attribution.
