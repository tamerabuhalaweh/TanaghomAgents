# Headcount delta 2026-10-03 (Groky legacy reference only)

This note describes the 2026-10-03 Groky headcount adaptation now reflected in
`archive/legacy-v0`. It is **reference and recovery material, not deployable
Tanaghom source** — same status as the rest of `archive/legacy-v0/README.md`.

## Source
- Adapted from https://github.com/cbrock84/headcount (MIT © Chris Brock).
  Methodology distilled + Groky field mapping, not verbatim copy.
  Regulator `references/sources.md` lists were NOT copied.
- Groky working material lives outside this repo (`Groky/n8n/prompts/reference/headcount/`,
  `Groky/docs/HEADCOUNT_ATTRIBUTION.md`). This archive is the secret-free snapshot.

## What changed in this delta
- `n8n/prompts/agent{1,2,4}_*.md` → v2 (headcount one-story/positioning, copy/hook/fold,
  lifecycle fit×intent, SMS discipline). Guards unchanged (strategy-only, drafts→pending_approval,
  approved-templates-only, staging dry-run, audit).
- `n8n/prompts/reference/headcount/01–08` (new) + `reference/headcount-future/00-overview.md` (new, disabled shells).
- `n8n/workflows/01_agent1_campaign_strategist.json` (inline LLM v2 deltas, backward-compat optional fields).
- `n8n/workflows/02_agent2_content_producer.json` (inline LLM v2 + parser preserves hook/proof in `draft_copy`, no DB migration).
- `n8n/workflows/06/07/08_*_stub.json` (new, `"active": false`, respond disabled).
- `db/migrations/006_headcount_templates.sql` (new: default_sales 6→13, all `pending_approval`, appends orders 7–13).
- `db/migrations/007_departments_stub.sql` (new: `departments` 5×inactive + `department_skills` 9×disabled).
- `dashboard/server.js` (`GET /api/departments` read-only, empty-safe pre-007; no approve buttons).
- Groky `docker-compose.yml` (fresh-boot 006/007 volumes) is NOT mirrored here — no compose in archive by design.
- Groky `04_agent4_sales_crm.json` unchanged (sequence_order-driven; new tail auto-extends).

## Non-goals / must NOT do with this material
- Do NOT run 001–007 SQL as Tanaghom migrations (targets unqualified `public`, incompatible with `tanaghom` schema).
- Do NOT import these n8n JSONs into live n8n (placeholder credential IDs, no E2E acceptance).
- Do NOT activate 06/07/08 stubs, spend, contact leads, or publish from this material.
- Do NOT treat reference skills as certified model quality (no live-model runs in this delta).

## Review pointers
- Guards to verify: Agent3 `status='approved'` re-check, Agent4 `status='approved'` ×2 + `template_blocked` + staging dry-run, stubs `"active": false`.
- Planning companion: `docs/planning/headcount-groky-adaptation.md`.
