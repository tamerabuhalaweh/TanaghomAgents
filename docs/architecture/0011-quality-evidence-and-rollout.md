# 0011 — Quality evidence and controlled autonomy

## Decision

Tanaghom will not treat response volume or speed as proof that an AI sales agent
improves the business. Promotion from human handling to shadow, assisted, and
bounded-autonomous stages requires version-attributed evaluation evidence and a
recorded organization-owner decision.

Migration `0020_quality_rollout_control` adds a safe baseline policy, append-only
evaluation snapshots, append-only rollout decisions, and a sequential promotion
function. n8n and conversation workers receive no table-write access. A rollout
decision does not activate a workflow, clear an emergency stop, or call a
provider.

## Rollout stages

1. Human baseline measures the customer's existing handling.
2. Shadow mode scores AI proposals without delivering them.
3. Assisted mode records human approvals, edits, and sends.
4. Bounded autonomy expands through separately approved 1%, 5%, 20%, and 50%
   pilots for eligible low-risk intents.

Stages cannot be skipped. Returning to the baseline evidence gate is allowed at
any time and preserves every prior snapshot and decision. Immediate provider
shutdown remains the responsibility of the existing GHL emergency controls;
the quality stage is deliberately not a second hidden runtime switch.

## Evidence contract

Each snapshot names its cohort and period, sample size, operational and funnel
metrics, limitations, source reference, and exact model, prompt, knowledge,
policy, and campaign versions. Missing metrics remain missing; the dashboard
shows an em dash and never substitutes fixtures.

The first promotion requires a reviewed human baseline. Later promotions also
require groundedness, policy compliance, qualification accuracy, unsupported
claim, complaint, and opt-out thresholds. The defaults are conservative design
values, not customer-approved production thresholds. Issue #56 remains open
until the customer approves metric formulas, imports representative evidence,
completes shadow and assisted acceptance, and runs a controlled staging contact.

## Customer-visible surface

`/quality` shows the current stage, rollout path, promotion requirements, latest
cohort evidence, missing-data states, and immutable decision history. Only an
accepted active owner can record a promotion or return to baseline. The screen
links to the separate automation controls so the operational boundary is clear.

## Current boundary

This slice is credential-independent and repository-only. It performs no
provider call, workflow activation, server deployment, customer message, or
production migration. Production migration and dashboard deployment require a
separate reviewed transaction after the pull request is approved.
