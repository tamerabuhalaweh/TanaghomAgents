# Agency PR review and model-setup handoff

Date: 2026-09-06. Scope: delegated Tanaghom technical PR review and #177 setup
preparation. After #198's review, Tamer selected an existing CPU VPS and shared
Gemma topology; only the CPU VPS was inspected read-only. No provider/model
call, remote configuration change or deployment was performed.

## PR #198: accepted source slice

- Reviewed head: `e4a06e396c785b3af9fb2b23983b916a3e682e59`.
- Merge: `9fde3aa673f4bc634c36bab00957cbf7f84ebd91`.
- [Exact-head CI](https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34035869262): 40/40 passed.
- Local recheck: 167/167 tests, repository verification and `git diff --check`
  passed. Original preparation and runner source locks still validate.
- Downloaded CI evidence JSON SHA256:
  `238d0e63d77fbcd30364990fa2567170be4db491bb7338139c157ffb656831bf`.
- Simulator evidence: 360 successful durable attempts, 324 authored model HTTP
  responses, 36 deterministic reports, 144 comparison pairs, 12 manual n8n
  executions; six negative controls passed. Real-model/provider calls: zero.
- Linux CI is the acceptance environment. The documented Windows host-network
  prerequisite fails before database startup; Windows execution is not certified.

Review covered API/role boundaries, immutable registration, lease-bound metadata,
fresh completion validation, baseline labeling, source locks, no-live-route
controls and bounded preflight/cleanup. No blocking defect was found in this
simulator-only scope. Codex authored and reviewed the slice under Tamer's
delegation; this is not independent human/security or customer approval.

## PR #44: historical evidence, not merged by this review

Reviewed head: `9afd3a0c67c626e347e55230bd341b0465851b99`. It adds one July 13
deployment report, which is absent from current main; it is not a duplicate to
discard. Its seven successful CI checks belong to the July baseline.

The review comment asks for refresh against current main, current checks and
an explicit historical-only/current-health-not-verified notice before archival
acceptance. No fresh verification of its deployment claims occurred. It stays
open and does not block #177. No archive text or live state was altered.

## Authority and outstanding decisions

Tamer delegated technical PR reviews. This does not automatically appoint a
business approver or two human bilingual reviewers, approve model execution,
purchase resources or authorize inference/deployment. No customer signoff has
been recorded. The plain-language proposal, review-row example, secret-free
operator inventory and staged gates are in
[Review and model setup](../planning/agency-expansion/REVIEW_AND_MODEL_SETUP.md).

Subsequent user direction supplied CPU VPS `155.117.45.45` and specified using
existing shared Gemma 4, not obtaining another GPU. The pending setup proposal
was revised before merge. A [read-only CPU-host inventory](2026-09-06-cpu-vps-readonly-preflight.md)
records 3 CPUs, 5,925 MiB RAM, about 40 GB free disk and existing co-hosted
workloads. No GPU-host connection or model probe occurred. Shared inference is
not model isolation: a successor manifest/transport, capacity limits and an
operator-approved request window are still required. Original frozen packages
are not retargeted and their prior isolated-model gate is not marked passed.

The revised CPU/shared-Gemma documentation passed local `npm test` (167/167),
`npm run check` (2,351 files) and `git diff --check`. Its own exact-head CI and
merge outcome belong to PR #199; #198's checks are not reused as its acceptance.

Original frozen corpus, rubric, prerequisites, runtime code, production
migrations and workflow exports remain unchanged by this follow-up. #177 remains
open for actual quality/resource and reviewer acceptance; #176 installation and
live-provider UAT remain separate. Production-release evidence: **60/100**,
unchanged; no new live release gate passed in this review/setup work.
