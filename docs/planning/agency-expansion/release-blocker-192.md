## Status and authorization

New release/CI blocker discovered while validating documentation PR #191 on 2026-09-06. Investigation and tracking only are complete; dependency remediation has not started and is not authorized by the planning-only #174 GO. This is a separate current-delivery gate, not a new specialist-department feature.

## Problem and observed evidence

The dashboard-contract job fails at `npm audit --audit-level=moderate` (exit 1):
https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34013065179/job/101432088191

The audit output at 2026-09-06T05:04:44Z reports 5 vulnerability entries (2 moderate, 3 high), including:
- fast-uri and dependent ajv: published host-confusion/SSRF advisory findings;
- nanoid: published custom-generator zero-size loop finding;
- postcss and dependent next: published sourceMappingURL-related file-read finding.

These are audit findings, not a demonstrated exploit of Tanaghom or proof of current production exposure. Investigate actual reachability and exact advisories before assigning runtime impact.

The root package.json, package-lock.json, apps/dashboard/package.json and quality.yml are unchanged between source baseline 0b5b5a761099e6eb6163efbeb00a75d891d680c7 and planning commit 7e36971b22c3b805c3fd22e1879594ca1ea2764b. This documentation PR did not introduce or update these dependencies. Local 111/111 tests passing does not satisfy the security audit gate.

## User story

As a customer and release owner, I need supported, reviewed dependencies and an honest security gate before new deployment or production acceptance.

## Required scoped remediation after GO

- Reproduce the audit against the exact lockfile; pin an evidence timestamp because advisory databases change.
- Review current primary advisories and identify affected direct/transitive dependencies, overrides and reachable Tanaghom paths.
- Propose the smallest compatible updates; do not blindly run npm audit fix --force or upgrade major/framework versions without impact review.
- Preserve structured-output/schema validation, URL/SSRF handling, auth/session, runtime gateway and rendering behavior.
- Update manifest/lockfile deliberately; include unit, type/build, database/workflow/browser regressions as applicable.
- Keep current audit thresholds; do not disable the job, hide findings or add unexplained exceptions.
- Prepare any required Tanaghom-only deployment separately with exact rollback; no protected-service change.

## Acceptance criteria

- [ ] Exact advisory IDs, affected/fixed versions and applicability assessment are recorded from current primary sources.
- [ ] A reviewed minimal dependency diff resolves the findings or an explicitly accepted, time-bounded risk decision documents a justified exception; no silent suppression.
- [ ] npm ci and npm audit --audit-level=moderate pass against the reviewed lockfile (unless a separately approved exception changes the formal gate).
- [ ] All applicable tests, typecheck/build and full PR CI pass, with new tests for any affected security boundary.
- [ ] No credentials, model/provider action, runtime permission widening, unrelated project mutation or public customer data appears.
- [ ] STATUS and release evidence distinguish source fix, deployment, runtime applicability and customer acceptance.
- [ ] Any deployment uses a separate authorized package; do not claim production patched from a merged dependency PR alone.

## Ownership and dependencies

Parent delivery lane: #125; related dashboard acceptance #3 and capacity/runtime safety #55. Documentation PR #191 must remain draft/not merge-ready while the audit failure is unresolved or unreviewed. This does not require implementing Epic #174 first.

Implementation owner: unassigned pending a scoped remediation GO. Reviewer: security/application maintainer designated in the PR. Tamer decides release scope and any exceptional risk acceptance.

## Validation and rollback

Use a clean/disposable dependency install and reproducible fixtures, not production probes. Preserve the exact prior lockfile and build identity. A rejected source diff is reverted through normal reviewed Git history; deployment rollback is a separate runtime decision with retained evidence.

## Definition of done

The reviewed source remediation and applicable security/regression evidence are merged, current release documentation is updated and any outstanding deployment gate is explicitly handed off. Keep this issue open until its agreed source/security scope is accepted; do not mistake a passing unit-test count for a passed audit.

## Non-goals

No audit bypass, uncontrolled npm fix, provider activation, production server access or SmartLabs/SmartCC/voice/Gemma service work.
