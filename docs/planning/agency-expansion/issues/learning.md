# Governed learning: evidence-to-skill proposals and versioned improvement review

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

Successful procedures and incidents should improve future work, but allowing an agent to silently rewrite prompts, memory, policies or skills would undermine reproducibility and tenant isolation.

## User story

As an owner, I want useful improvements proposed from my organization's evidence, reviewed and tested before they affect any active agent.

## Scope

- Extend existing immutable skill/knowledge/version provenance and #150's quarantined Skill Proposal Worker rather than create a competing learner.
- Accept sanitized tenant-scoped evidence from approved human feedback, failed/accepted work and evaluation results; define purpose, minimization, retention and deletion behavior.
- Produce quarantined proposals with evidence references, rationale, proposed changes, exclusions, risk and regression cases.
- Keep independent controls for data observation, proposal generation, publication and rollout; initial mode is off/proposal-only.
- Detect stale source versions, duplicate proposals, contradictory feedback, poisoned memories and cross-tenant material.
- Require owner review, evaluation and separately approved binding/rollout changes; no auto-publication or promotion.

## Dependencies and ownership

- #150 owns optional Hermes observation/proposal runtime; #133/#135 own skills/runtime.
- #177/#137 certification; #178/ #179 only for future team-specific observations.

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] All learned candidates remain draft proposals with tenant, provenance, source hashes, reviewer decisions and immutable version ancestry.
- [ ] Observation or proposal generation cannot mutate published knowledge/skills, agent bindings, permissions, schedules or model weights.
- [ ] No secrets, unsupported PII or another organization's data enters memory, proposals or evaluation fixtures.
- [ ] Poisoned, misleading, duplicated, stale and cross-tenant evidence is rejected or quarantined with clear reasons.
- [ ] Human acceptance alone does not bypass #177/#137 or permission checks; failed regressions block rollout.
- [ ] Turning learning/Hermes off prevents new observations/proposals and preserves ordinary Tanaghom operation and existing evidence.
- [ ] A disposable example demonstrates feedback -> proposal -> reject/approve -> new draft version -> tests, with zero external actions.

## Validation and evidence

Two-tenant adversarial evidence and memory tests, lifecycle/role tests, proposal deduplication, version conflict, stop propagation and rollback refusal. Separate human review from model-generated recommendation.

## Deployment and rollback

Turn off new observation/proposal jobs; retain reviews/audit and roll back bindings to prior certified versions when authorized. Use forward recovery if data makes destructive downgrade unsafe.

## Non-goals

- No unrestricted self-learning, self-modification, model training, shared cross-customer memory, or automatic skill activation.
- No bypass of #150 isolation rules or production access.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/learning.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
