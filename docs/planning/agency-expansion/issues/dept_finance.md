# Department expansion: finance capabilities with human-controlled financial decisions

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

The approved all-department roadmap includes 5 source profiles across finance. They are catalogued, not adapted, tested, available or activated. Support evidence-backed finance analysis and planning while separating analytical drafts from transactions, commitments and regulated decisions.

## User story

As an organization owner, I want support evidence-backed finance analysis and planning while separating analytical drafts from transactions, commitments and regulated decisions. with a clear capability boundary and no assumption that a role title grants authority.

## Scope

- Preserve coverage of all 5 pinned profiles in these divisions; the catalog is the authoritative per-profile checklist.
- Support evidence-backed finance analysis and planning while separating analytical drafts from transactions, commitments and regulated decisions.
- Required data: Explicitly authorized financial datasets with access minimization, declared currency/accounting periods, source lineage and customer-approved calculation rules.
- Review risks: Financial secrets, incorrect arithmetic, mixed currencies, invented forecasts, unauthorized payments/trading/credit decisions and overconfident professional advice.
- Initial execution boundary: Read-only analysis and reviewable drafts first. No payments, trading, account changes, credit decisions, financial commitments or professional certification without a separate domain-specific authority and qualified human gate.
- Create a domain charter and bounded implementation child issues after reviewing each profile; reuse existing skills/owners and explicitly identify missing executors/connectors.
- Define at least one small representative end-to-end simulation per proposed capability bundle before broad admission. Separate English/Arabic support and unverified specialist-domain language needs.

## Dependencies and ownership

- #174; #175 semantic review; pilot/evaluation #176/#177 before broad rollout.
- Existing #134/#135 runtime; #137 domain/language certification; #136 only if new connectors are required.
- #153 canonical reporting principles, not a finance executor
- #180 guarded evidence reuse

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] All 5 assigned profiles have a reviewed disposition, primary delivery owner, source/skill versions, permissions, data classification, domain reviewer and next gate; none is silently omitted.
- [ ] The domain charter and any exceptional restrictions are approved before executable work begins; list customer facts and qualified review needed.
- [ ] Any reused source content is normalized, attributed and bound only to reviewed operations; unsupported tools cannot appear as available.
- [ ] Every admitted template is tenant-isolated, version-pinned, default-off and separately certified with its required language/domain scenarios.
- [ ] Required representative cases include: Zero/missing values, currency/time-window mismatch, contradictory balances, fabricated source, sensitive account disclosure, unauthorized transfer request and calculation regression.
- [ ] Simulation uses synthetic/approved de-identified data and produces no external actions; proposed provider/compute operations remain unavailable until their own gate passes.
- [ ] All assigned profiles are eventually adapted/certified for their permitted scope, or an explicit Tamer-approved restriction/defer/reject decision records why; metadata alone cannot close this department issue.
- [ ] The department's customer-visible availability, blockers, acceptance evidence and scope exceptions are updated in the catalog/status documents.

## Validation and evidence

Use per-profile contract tests plus two-tenant authorization and adversarial tests, measured resource/latency limits, stop/replay/recovery evidence and qualified domain review where relevant. Zero/missing values, currency/time-window mismatch, contradictory balances, fabricated source, sensitive account disclosure, unauthorized transfer request and calculation regression. No live customer/provider activity is authorized by this planning issue.

## Deployment and rollback

Keep templates disabled until accepted. Revoke/deprecate versions or disable the department without deleting business/audit history; any new adapter/migration has separate scoped deployment and rollback/forward-recovery evidence.

## Non-goals

- No implementation or activation from the current documentation GO; no promise of unrestricted parity with every upstream role.
- No raw upstream installers/plugins, arbitrary code, cross-tenant memory, customer secrets in Git, or protected SmartLabs/SmartCC/voice/Gemma-host changes.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/dept_finance.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
