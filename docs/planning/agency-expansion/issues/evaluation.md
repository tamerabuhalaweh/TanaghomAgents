# Agency pilot: paired bilingual quality, safety, cost and latency evaluation

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

Upstream personas and target metrics do not prove improvement on Tanaghom's Gemma runtime or customer tasks. More specialist calls can increase latency or introduce confident errors.

## User story

As a release reviewer, I need reproducible evidence that adapted profiles improve or preserve useful work without weakening safety or misleading us with aggregate scores.

## Scope

- Extend #137's certification and #56's quality evidence rather than create a second evaluation authority.
- Freeze a versioned representative dataset: proposed initial minimum 20 English and 20 Arabic cases, with coverage of all six pilot profiles; record that this is an initial evaluation set, not statistical proof of conversion uplift.
- Compare current and adapted profiles with the same model/runtime, tools, approved knowledge, inputs, and evaluation conditions; record repeated runs where nondeterminism matters.
- Pre-register owner-approved scoring rubrics and thresholds before reading adapted outputs; retain held-out cases and human review of disagreements.
- Measure task success, groundedness, unsupported claims, useful escalation, brand adherence, correction effort, tool/policy compliance, p50/p95 latency and token/step consumption.
- Include prompt injection, cross-tenant attempts, missing/stale evidence, duplicates, provider uncertainty, model failure, emergency stop, and loop exhaustion.
- Report per-language/per-profile results, sample sizes, uncertainty and untested cases; no single average can hide failure.

## Dependencies and ownership

- #176 contracts and selected source review from #175.
- Existing #137 certification, #56 baselines and #55 capacity controls.

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] The complete baseline/dataset provenance, de-identification/rights, exact profile/model/schema/tool hashes, seed/config where applicable, rubric and reviewer decisions are recorded.
- [ ] All six profiles and both languages have meaningful paired coverage; initial sample minimum and coverage gaps are explicit.
- [ ] Any unauthorized action or tenant/credential leak is a hard failure regardless of quality score.
- [ ] Adapted profiles meet pre-approved non-regression thresholds, with evidence for any claimed improvement; no uplift is claimed from prompt text or simulations alone.
- [ ] Safety certification and full campaign/conversation regressions remain green.
- [ ] Required runtime and memory budgets are measured; short inbound paths avoid unnecessary manager/specialist calls.
- [ ] Customer/provider outcomes remain unverified until #125/#137 live gates pass; sim-only results are never labeled live UAT.

## Validation and evidence

Produce machine-readable paired results plus a human-readable report with failed cases, version hashes and review decisions. Keep test harnesses credential-independent by default and separate offline checks from any approved real-model measurement.

## Deployment and rollback

Revoke a failed profile's eligibility and retain prior certified bindings and failed evidence. Re-running evaluations creates new records; no overwriting scores or dropping failed cases.

## Non-goals

- No promise that AI outperforms humans or that more agents increase throughput.
- No customer production traffic, unapproved model probes, provider actions, or fabricated test results.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/evaluation.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
