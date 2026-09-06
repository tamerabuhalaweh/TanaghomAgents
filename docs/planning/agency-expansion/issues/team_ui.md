# AI teams: owner onboarding and evidence-backed organization operations view

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

A flat roster of agent cards does not explain departmental accountability or how an outcome is progressing. A visually impressive team display could also mislead customers if it invents activity or hides blocked capabilities.

## User story

As a customer, I want to choose a certified starter team, understand its permissions, assign an outcome and inspect actual handoffs, deliverables, review requests and blockers.

## Scope

- Extend existing Agent Studio, Agents, campaign and supervisor surfaces; avoid a second administration application.
- Show departments/team templates, role responsibilities, exact skills/versions, dependencies and availability separate from activation.
- Offer guided owner setup using existing customer-managed integrations and knowledge; identify unsupported capabilities before submission.
- Show assignment progress, actual job states, artifact/review history, budgets, failures and next action with links to evidence.
- Provide accessible desktop/mobile and English/Arabic/RTL states, keyboard navigation, loading/error/empty/permission/conflict handling.
- Connect optional supervisor proposals to the same review surface; off/disabled features produce no hidden work.
- Display concise decision explanations and source evidence, not invented private reasoning transcripts.

## Dependencies and ownership

- #178 versioned assignment API; #176 certified templates.
- #134 Studio; #14 browser/RTL QA; #150 optional supervisor controls.

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] An owner can configure the pilot team without n8n access and sees the exact permissions, dependencies and proposed mode before saving.
- [ ] A reviewer can follow an assignment to real artifacts and approvals; operators/viewers see only authorized tenant data.
- [ ] No card is marked active, completed or healthy from catalog membership, a template claim, or stale unqualified evidence.
- [ ] Blocked, waiting-human, failed, partial, cancelled and stale states are explicit and actionable.
- [ ] All mutations use reviewed authenticated/tenant-checked APIs; a UI control cannot clear platform stops or override certification.
- [ ] Playwright evidence covers responsive layout, accessibility, Arabic/RTL, roles and complete bounded team journeys.
- [ ] Existing campaign, approval, content and Studio workflows remain regression-tested.

## Validation and evidence

Component/API/permission tests plus browser tests with deterministic fixtures and disposable data. Screenshots are supporting evidence, never substitutes for functional assertions. No live integrations are required for initial UI acceptance.

## Deployment and rollback

Disable team navigation/feature without changing standalone operations or deleting assignment history. Revert dashboard image only through a separately reviewed release.

## Non-goals

- No cosmetic fake activity, broad redesign of approved screens, raw credential exposure, or new runtime authority.
- No production deployment in the UI implementation PR.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/team_ui.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
