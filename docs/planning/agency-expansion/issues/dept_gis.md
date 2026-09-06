# Department expansion: GIS and geospatial analysis teams

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

The approved all-department roadmap includes 13 source profiles across gis. They are catalogued, not adapted, tested, available or activated. Evaluate bounded geospatial analysis and reporting using permissioned data and transparent coordinate/precision assumptions.

## User story

As an organization owner, I want evaluate bounded geospatial analysis and reporting using permissioned data and transparent coordinate/precision assumptions. with a clear capability boundary and no assumption that a role title grants authority.

## Scope

- Preserve coverage of all 13 pinned profiles in these divisions; the catalog is the authoritative per-profile checklist.
- Evaluate bounded geospatial analysis and reporting using permissioned data and transparent coordinate/precision assumptions.
- Required data: Approved geospatial datasets, declared coordinate reference systems, time/precision bounds and licensed map layers.
- Review risks: Sensitive location data, incorrect coordinate transformation, unlicensed map material, oversized/geospatial files, unsafe critical-infrastructure inference and unreviewed remote fetching.
- Initial execution boundary: Read-only analysis on approved datasets; rendering/compute needs separately reviewed isolated tooling and quotas. No live tracking, critical infrastructure control or private/host access.
- Create a domain charter and bounded implementation child issues after reviewing each profile; reuse existing skills/owners and explicitly identify missing executors/connectors.
- Define at least one small representative end-to-end simulation per proposed capability bundle before broad admission. Separate English/Arabic support and unverified specialist-domain language needs.

## Dependencies and ownership

- #174; #175 semantic review; pilot/evaluation #176/#177 before broad rollout.
- Existing #134/#135 runtime; #137 domain/language certification; #136 only if new connectors are required.
- #136 future data/compute connectors
- #137 domain-specific test extension

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] All 13 assigned profiles have a reviewed disposition, primary delivery owner, source/skill versions, permissions, data classification, domain reviewer and next gate; none is silently omitted.
- [ ] The domain charter and any exceptional restrictions are approved before executable work begins; list customer facts and qualified review needed.
- [ ] Any reused source content is normalized, attributed and bound only to reviewed operations; unsupported tools cannot appear as available.
- [ ] Every admitted template is tenant-isolated, version-pinned, default-off and separately certified with its required language/domain scenarios.
- [ ] Required representative cases include: CRS mismatch, missing coordinates, privacy-sensitive exact locations, stale layers, oversized inputs, malicious metadata and unsupported precision claims.
- [ ] Simulation uses synthetic/approved de-identified data and produces no external actions; proposed provider/compute operations remain unavailable until their own gate passes.
- [ ] All assigned profiles are eventually adapted/certified for their permitted scope, or an explicit Tamer-approved restriction/defer/reject decision records why; metadata alone cannot close this department issue.
- [ ] The department's customer-visible availability, blockers, acceptance evidence and scope exceptions are updated in the catalog/status documents.

## Validation and evidence

Use per-profile contract tests plus two-tenant authorization and adversarial tests, measured resource/latency limits, stop/replay/recovery evidence and qualified domain review where relevant. CRS mismatch, missing coordinates, privacy-sensitive exact locations, stale layers, oversized inputs, malicious metadata and unsupported precision claims. No live customer/provider activity is authorized by this planning issue.

## Deployment and rollback

Keep templates disabled until accepted. Revoke/deprecate versions or disable the department without deleting business/audit history; any new adapter/migration has separate scoped deployment and rollback/forward-recovery evidence.

## Non-goals

- No implementation or activation from the current documentation GO; no promise of unrestricted parity with every upstream role.
- No raw upstream installers/plugins, arbitrary code, cross-tenant memory, customer secrets in Git, or protected SmartLabs/SmartCC/voice/Gemma-host changes.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/dept_gis.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
