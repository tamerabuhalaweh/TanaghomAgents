# AI teams: bounded departmental assignments and durable coordination

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

The shared runtime already has tenant-bound jobs and a reviewed agent_handoff path after successful parent work. It does not by itself provide a general departmental assignment planner, dependency graph, team budget, or customer-visible ownership semantics.

## User story

As an owner, I want to delegate an outcome to a team and see who owns every deliverable, what is blocked, and when a human must decide.

## Scope

- Extend the existing jobs, correlation, immutable versions, runtime handoff and attestation contracts; do not create a parallel memory/queue authority.
- Define versioned team templates, role responsibilities, parent/child assignments, dependencies, structured artifacts and acceptance criteria.
- Start with a deterministic bounded marketing/content team; manager output proposes assignments but cannot grant permissions.
- Enforce per-assignment and whole-team step/token/time/concurrency/retry budgets, depth limits, cycle prevention, cancellation and stop propagation.
- Handle partial fan-out results, repeated handoffs, stale artifact versions, ownership conflicts, overdue reviews, supervisor unavailability and restart recovery.
- Keep the inbound conversation fast path independent; involve extra specialists only by approved policy.
- Use one supervisor interface. Hermes #150 remains an optional proposal-only implementation, never a competing controller.

## Dependencies and ownership

- #135 runtime and its phase7.agent-handoff.v1 contract; #176 provides the first bounded business team.
- #177/#137 certification; #55 capacity; #179 consumes this contract.
- #150 is optional and not a dependency for deterministic team execution.

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] Every assignment records organization, authorized requester, exact team/agent/skill versions, parent, dependency IDs, correlation, deadline/budget, expected artifact and acceptance owner.
- [ ] Only the existing reviewed runtime boundary can create/claim permitted agent handoffs; model text and dashboard requests cannot forge source identity or authority.
- [ ] Cycles, excessive depth/steps, duplicate work, conflicting ownership, partial results and stale dependency artifacts are handled deterministically with audit evidence.
- [ ] All team members remain individually policy-checked; delegated work cannot exceed the originating request or child permissions.
- [ ] Pause/cancel/stop propagation blocks new work and rechecks in-flight action authorization while preserving completed history.
- [ ] Human approval remains separate from agent QA; timeout never defaults to approval.
- [ ] Disposable end-to-end and crash/replay tests demonstrate one bounded team journey with no duplicate external actions.
- [ ] Existing standalone agents and jobs continue to function with optional team coordination disabled.

## Validation and evidence

Disposable two-tenant tests with restart, race, fan-in failure, loop exhaustion, cancel/stop, changed-version, forged-handoff, duplicate and uncertain-provider cases. Compare standalone vs team latency/cost; add no live provider test by default.

## Deployment and rollback

Feature off must leave standalone runtime behavior intact. Preserve assignment/audit data; migration downgrade must refuse destructive removal when data exists and offer reviewed forward recovery.

## Non-goals

- No unrestricted agent-to-agent chat mesh, arbitrary task spawning, autonomous privilege changes, or new runtime replacement.
- No host/SmartLabs/SmartCC/voice/Gemma configuration changes.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/teams.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
