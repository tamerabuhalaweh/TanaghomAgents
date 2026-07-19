# Phase 6 credential-independent agentic simulation

## Purpose

This gate proves the assembled Tanaghom content-to-sales foundation without a
customer credential, production provider, real lead, publishing action, paid
action, or SmartLabs contact. It is acceptance evidence for Issue #7; it is not
customer staging acceptance and does not authorize workflow activation.

## Boundaries

- One disposable PostgreSQL database at migration `0021`.
- The immutable n8n `2.26.8` image already used by the component workflow gates.
- All seven committed workflow exports imported and executed only through their
  manual test triggers while `active=false`.
- Deterministic local Gemma, Postiz, and GHL simulators.
- Synthetic `.test` identities and zero advertising spend.
- No production URL, customer credential, public webhook registration, real
  provider account, GPU service, voice path, or SmartLabs resource.

## Customer-shaped narrative

1. Campaign Strategist produces structured positioning, messages, channels,
   cadence, and content pillars.
2. Content Producer creates review-only content and leaves it pending human
   approval.
3. The Postiz worker accepts a human-approved content item, creates exactly one
   simulated draft, rejects a forged unapproved job, and normalizes historical
   performance evidence.
4. The GHL contact worker performs one duplicate-safe simulated contact upsert.
5. A signed inbound question is accepted once, duplicate delivery is recorded,
   and approved knowledge produces a cited proposal with zero external action.
6. A supervisor explicitly releases the conversation and approves a reply,
   qualification, appointment, and opportunity action. Replays preserve the
   original jobs and simulated provider references.
7. English and Arabic policy cases verify grounding, escalation, language, and
   adversarial behavior.
8. The Quality Shadow Evaluator records proposal-only evidence and enforces
   `external_action_count = 0`.

## Evidence

The CI job uploads one secret-free artifact containing:

- exact workflow IDs, paths, inactive state, and SHA-256 digests;
- the pinned n8n image digest;
- each acceptance step and duration;
- duplicate-delivery and replay evidence;
- grounded knowledge citation and supervisor decisions;
- simulated action types and final lead state;
- English and Arabic evaluation metrics;
- quality result and zero-external-action evidence; and
- explicit limitations.

The artifact is written to `tmp/phase6-agentic-simulation-evidence.json`. The
supporting component evidence is written below `tmp/phase6-support/`.

## Run locally

Use only a disposable database whose name is
`tanaghom_agents_workflow_test`; the Phase 3 credential fixture intentionally
refuses to infer a production database name.

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tanaghom_agents_workflow_test
export DATABASE_TEST_URL="$DATABASE_URL"
npm run db:migrate
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 -f packages/database/seeds/staging.sql
npm run build:dashboard
npm run test:phase6-agentic
```

## Pass criteria

- Every one of the seven exports remains inactive and has no public webhook.
- All seven exports execute through the pinned n8n image.
- Strategy, content, draft, performance, contact, governed actions, and quality
  stages emit their acceptance markers.
- Forged approval and duplicate-delivery paths fail closed or replay the
  original durable record.
- English and Arabic evaluation evidence exists.
- Simulated GHL lifecycle ends with a qualified lead, appointment, and
  opportunity evidence.
- Quality results record zero external actions.
- No unexpected personal-data identity is present in the disposable database.
- The combined evidence artifact reports `result: passed`.

## Remaining acceptance after this gate

- Live customer Postiz business-channel validation.
- Live customer GHL staging validation and provider quota evidence.
- Customer-approved knowledge, templates, test contacts, and de-identified
  human baseline.
- Authenticated desktop/mobile browser QA, Arabic RTL QA, and customer UAT.
- Separately approved production activation and rollback.
