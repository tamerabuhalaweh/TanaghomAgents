# Department expansion: game-development and spatial-computing teams

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

The approved all-department roadmap includes 27 source profiles across game-development, spatial-computing. They are catalogued, not adapted, tested, available or activated. Plan and evaluate creative/interactive prototypes without adding unbounded rendering, executable-content or GPU workloads to the existing product.

## User story

As an organization owner, I want plan and evaluate creative/interactive prototypes without adding unbounded rendering, executable-content or GPU workloads to the existing product. with a clear capability boundary and no assumption that a role title grants authority.

## Scope

- Preserve coverage of all 27 pinned profiles in these divisions; the catalog is the authoritative per-profile checklist.
- Plan and evaluate creative/interactive prototypes without adding unbounded rendering, executable-content or GPU workloads to the existing product.
- Required data: Approved design briefs, assets and source projects with recorded usage rights and artifact limits.
- Review risks: Heavy GPU/storage load, unsafe project scripts/plugins, unlicensed assets/fonts/audio, artifact path traversal, unsupported hardware assumptions and physical-space privacy.
- Initial execution boundary: Design/code/artifact proposals first. Rendering or executable builds require isolated certified workers and a separately approved capacity/host decision; never use protected production GPU/voice workloads by implication.
- Create a domain charter and bounded implementation child issues after reviewing each profile; reuse existing skills/owners and explicitly identify missing executors/connectors.
- Define at least one small representative end-to-end simulation per proposed capability bundle before broad admission. Separate English/Arabic support and unverified specialist-domain language needs.

## Dependencies and ownership

- #174; #175 semantic review; pilot/evaluation #176/#177 before broad rollout.
- Existing #134/#135 runtime; #137 domain/language certification; #136 only if new connectors are required.
- #157 optional video rendering ownership
- #136 future tool adapters
- #55 capacity methodology

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] All 27 assigned profiles have a reviewed disposition, primary delivery owner, source/skill versions, permissions, data classification, domain reviewer and next gate; none is silently omitted.
- [ ] The domain charter and any exceptional restrictions are approved before executable work begins; list customer facts and qualified review needed.
- [ ] Any reused source content is normalized, attributed and bound only to reviewed operations; unsupported tools cannot appear as available.
- [ ] Every admitted template is tenant-isolated, version-pinned, default-off and separately certified with its required language/domain scenarios.
- [ ] Required representative cases include: Oversized assets, untrusted scripts, missing rights, hardware mismatch, render timeout/cancellation, artifact quotas and accessibility/Arabic layout issues.
- [ ] Simulation uses synthetic/approved de-identified data and produces no external actions; proposed provider/compute operations remain unavailable until their own gate passes.
- [ ] All assigned profiles are eventually adapted/certified for their permitted scope, or an explicit Tamer-approved restriction/defer/reject decision records why; metadata alone cannot close this department issue.
- [ ] The department's customer-visible availability, blockers, acceptance evidence and scope exceptions are updated in the catalog/status documents.

## Validation and evidence

Use per-profile contract tests plus two-tenant authorization and adversarial tests, measured resource/latency limits, stop/replay/recovery evidence and qualified domain review where relevant. Oversized assets, untrusted scripts, missing rights, hardware mismatch, render timeout/cancellation, artifact quotas and accessibility/Arabic layout issues. No live customer/provider activity is authorized by this planning issue.

## Deployment and rollback

Keep templates disabled until accepted. Revoke/deprecate versions or disable the department without deleting business/audit history; any new adapter/migration has separate scoped deployment and rollback/forward-recovery evidence.

## Non-goals

- No implementation or activation from the current documentation GO; no promise of unrestricted parity with every upstream role.
- No raw upstream installers/plugins, arbitrary code, cross-tenant memory, customer secrets in Git, or protected SmartLabs/SmartCC/voice/Gemma-host changes.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/dept_media.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
