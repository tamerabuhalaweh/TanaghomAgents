# Agency pilot: paired bilingual quality, safety, cost and latency evaluation

## Authorization and status

PR #196's authenticated integration, PR #197's evaluation preparation and PR #198's isolated comparison simulator are accepted; real-model certification is not executed. `evaluation/agency-v1/RUNBOOK.md` documents 48 core cases plus 24 public reserves, 47 pinned sources, paired requests through the actual adapter, proposed anchored rubrics/resource budgets and a NOT_RUN real-model ledger. Public reserves are not blind holdout data. No model-quality score has been generated. Customer/domain acceptance, private heldout/reference answers, exact isolated model/compiler pins, reviewed real-model transport and separately authorized execution remain pending. Studio availability and production installation are separate #176 work.

### Preparation progress (not quality acceptance)

PR #197 is accepted at 7317b2e085f0b80d12bc0fb2c862d247716600a9 (39/39 checks).
PR #198 is accepted at 9fde3aa673f4bc634c36bab00957cbf7f84ebd91 (40/40 checks).
It implements `evaluation/agency-runner-v1`:
fixed baseline/adapted selection, actual owner-JWT queueing, restricted worker
RPCs, immutable attempt labels, current database fact checks and a 360-attempt
disposable n8n comparison test (324 simulated HTTP responses, 36 local reports).
It changes no production API, migration or workflow. The prior preparation
source lock remains unchanged. Runtime validation evidence belongs to the
introducing PR and its unique CI artifacts, not a real-model quality score.

- [x] Authored synthetic six-profile EN/AR corpus with honest public-reserve labeling.
- [x] Pin source/procedure/schema/workflow/rubric inputs and reject drift.
- [x] Generate equal-condition baseline/adapted requests for four reused skills; separate Brand/Executive human-reference baselines.
- [x] Proposed rubrics, safety regression map, request budgets and stop/handoff procedure.
- [x] Offline tests, pending attempt ledger and explicit no-execution authority.
- [ ] Freeze customer/domain-approved rubric, genuine heldout cases, reference answers and reviewers.
- [x] Implement the isolated authenticated paired runner without accepting arbitrary prompts in protected APIs; simulator validation is separate from real-model acceptance.
- [ ] Pin actual model/weights/tokenizer/compiler environment and measure bounded schema probes.
- [ ] Execute paired model evaluation, measure resources, adjudicate results and record #137/#56 release decision.

Reviewer clarification: these are people reading sample AI answers for business
accuracy and English/Arabic usefulness, not technical accounts or API keys.
Tamer has not yet nominated the reviewers; no customer signoff is recorded.
The proposed two-person rubric remains unapproved. `prerequisites.json` names
each missing decision/model identity and its checker never authorizes execution.
Runner implementation is in PR #198. Local unit tests: 167 passed; complete
Linux comparison CI and a diagnostic Windows run each completed 360 attempts.
Intermittent local HTTP aborts are retained as a known reproducibility limitation.
The runner now requires a verified Docker host-network loopback path before
database startup, with Linux CI as its acceptance environment. The former Windows
hostname fallback is removed; no host settings change is performed. See the
versioned implementation evidence and the final PR-head checks/artifacts.

Tamer has delegated technical PR reviews to Codex, not customer business
signoff. The reviewer/isolated-model setup proposal is documented at
docs/planning/agency-expansion/REVIEW_AND_MODEL_SETUP.md, with an example review
row, required operator inventory and compiler -> eight-request smoke -> paired
quality gates. The customer-reviewer nomination and isolated environment/model
facts remain missing; no authority, credentials, model calls or passing scores
are inferred from this documentation or PR-review delegation.

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

Source implementation and source review for this slice: Codex. Product/scope owner: Tamer. Customer/domain approver: to be designated by Tamer before quality acceptance or rollout; no independent review or customer signoff is implied. Other future slices remain unassigned.

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
