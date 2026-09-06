# Agency bilingual quality certification: preparation v1

Owner: [#177](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/177),
under the existing #137 certification and #56 quality/release authorities.
Accepted integration: PR #196, merge
`3769d5ae7abe2e98d6e3d7ad612d30160f886e30` (39/39 CI checks passed).

**This package is offline preparation, not model certification or deployment.**
It contains no model transport, server connection, credential loader, migration,
workflow activation or automatic certification command. Studio installation and
customer-facing availability remain separate #176 work. SmartLabs, SmartCC,
voice, production Gemma, Nginx, firewall and credentials are out of scope.

## What can be reviewed now

- `corpus.json`: 48 development cases (four per profile/language), plus 24
  separately marked public reserve cases. All 72 are original synthetic text;
  no customer data or inferred rights. A bilingual customer/domain reviewer
  must confirm suitability. Public reserves are **not** a blind holdout.
- `rubric.json`: proposed anchored 0–4 ratings, hard-failure definitions,
  thresholds, independent review, resource limits and unresolved approvals.
- `source-lock.json`: exact normalized source, skill, prompt, schema, corpus,
  rubric, integration and workflow hashes. Editing a locked input breaks the
  check; a reviewed new freeze is required, not a silent regeneration.
- `run-authorization.template.json`: missing runtime/reviewer decisions. Its
  approval fields are deliberately null. It is not an executable permission.
- `scripts/agency-quality-preparation.mjs`: prepares 72 cases through the actual
  merged `prepareTask()` adapter using synthetic resolved bundles. It produces
  paired requests with an unmistakably unapproved model placeholder and an
  unscored `NOT_RUN` attempt ledger. It does not authenticate those fixtures.

Run from the repository root, without loading `.env`:

```powershell
npm ci
npm test
npm run check
npm run test:agency-quality-preparation
node scripts/agency-quality-preparation.mjs --packet
```

The last command prints the synthetic packet for review; it does not execute
it. The default command prints only the preparation summary and blockers.
`--live`, arbitrary paths and other execution flags are rejected. `--lock`
prints proposed hashes for a source-review diff; it cannot approve a freeze.
The test packet's historical clock, leases, IDs and placeholder model cannot
be copied into a production queue. A later authenticated isolated runner must
create independent case/arm/repetition jobs and let the database resolve their
fresh ownership, policy and lease state.

## Comparison contract

| Profile | Baseline | Adapted arm | What this can establish |
| --- | --- | --- | --- |
| Social Media Strategist | Pinned unaugmented platform strategy skill | Same wrapper plus reviewed Agency procedure | Procedure effect under the same v1 contract |
| Content Creator | Pinned unaugmented platform content skill | Same wrapper plus reviewed Agency procedure | Grounded draft quality and lineage preservation |
| Discovery Coach | Pinned unaugmented conversation skill | Same wrapper plus reviewed Discovery procedure | Helpful concise qualification versus current instruction source |
| Support Responder | Same pinned conversation skill | Same wrapper plus reviewed Support procedure | Grounding, useful escalation and honest completion language |
| Brand Guardian | Customer-approved reference findings, not another AI worker | Semantic proposal plus deterministic precheck | Reference correctness, citations and rights gaps; no AI-baseline uplift |
| Executive Summary | Customer-approved reference report | Deterministic observation report, **no model call** | Exact arithmetic, denominators, windows and explicit gaps |

The four paired model arms differ **only in system instructions**. User input,
model, output schema, temperature, output-token allowance and tool authority
are identical. Use the adapted arm's conservative allowance for both arms.
Input tokens naturally differ; measure rather than hide that cost.

This is a controlled procedure comparison on the new #196 simulation lane,
**not a comparison against the currently deployed production pipeline**.
The strategy contract here is v1; an existing business export uses v2. Do not
rename a source-skill baseline as a verified live v2 baseline or silently swap
schemas. A deployment-level comparison needs its own reviewed mapping/freeze.

With three predetermined repetitions, the full public corpus plans **324 model
attempts** (288 paired-arm + 36 Brand) and **36 deterministic report attempts**.
Development subset: 216 model attempts; reserve subset: 108. Twenty-four
Brand/report case references must be approved; they are currently absent.
These are maximum proposed attempts, not authorized work. Repetitions are not
automatic retries. Keep every failure/refusal/timeout; no best-of selection.

## Gates before any real-model request

1. Tamer designates a customer/domain approver and two English/Arabic reviewers.
   Approve the scenarios, reference answers, rubric, absolute budgets and
   non-regression thresholds **before** either arm's output is visible.
2. Have a reviewer create a genuinely withheld set in restricted review storage,
   record its digest, data rights and access policy, and exclude it from prompts,
   tuning and development. Adding it changes the corpus/attempt budget: publish
   a new reviewed run manifest. Do not claim our public reserve is hidden.
3. Record exact served model identifier, immutable weights revision/digest,
   tokenizer/chat-template hashes, quantization, context limit, inference
   parameters/seed support, vLLM/xgrammar versions and immutable image digests.
   These values are presently unknown. Record unsupported seed fields as such;
   do not pretend temperature 0.1 guarantees reproducibility.
4. Provision/approve an **isolated** matching model environment through its
   owner. This package does not install one or administer shared Gemma. Agree
   GPU/RAM budget, free headroom, time limit and rate/cost basis. A model name
   alone is not a weights pin. Do not use the shared production Gemma endpoint
   as the compiler test environment.
5. Complete the reviewed authenticated evaluation runner. PR #196 proves the
   disposable JWT/PostgreSQL/n8n lane, but its authored-response stub is not a
   bilingual quality runner and its protected API cannot accept arbitrary
   baseline prompts. Add a simulation-only fixed baseline selector through a
   separately reviewed adapter/manifest, never a customer-supplied prompt or
   direct-SQL bypass. Record source SHA and new regression evidence.
6. Run a **local isolated compiler-only** compatibility test of the four actual
   guided output schemas (strategy/content/conversation/Brand). The packet's
   recursive open-object/minProperties screen is necessary but not sufficient:
   it is not an xgrammar compiler or evidence that the historic fatal crash is
   resolved. Retain compiler image/schema hashes, exit status and bounded logs.
7. After compiler acceptance and separate bounded authorization, run at most
   eight isolated schema smoke requests (four schemas × English/Arabic), one
   outstanding request at a time. Check model health before/after each request.
   Then stop and review. No automatic restart, repeat or shared-service probe.
8. Only after that gate passes, authorize the frozen quality run with exact
   request cap, timeout, maximum elapsed time, model identity and reviewer plan.
   Eight smoke plus 324 public comparison attempts is a cap of 332, excluding
   any separately approved hidden corpus. Start inbound paths without specialist
   cascades. No provider execution, real customer input or budget spending.

Preparation can be accepted before these execution gates pass. It must never
be labeled `execution_ready` or `certified` merely because unit tests pass.

## Safety evidence: reuse existing authorities

| Required scenario | Evidence path to re-run at the evaluated source |
| --- | --- |
| Success, refusal, escalation, injection, provider failure, duplicate/retry, stop in EN/AR | `npm run test:phase7d-certification` (#137 canonical seven classes) |
| Authentication/tenant/lease isolation, stale evidence, model failure, exhausted retries, DND, takeover, stops | `npm run test:agency-integration` (actual disposable n8n/PG, simulated model) |
| Campaign/content lineage and approval | `npm run test:phase3-workflows`, `npm run test:phase6-agentic` |
| Conversation policy/injection/escalation | `npm run test:phase5-intelligence`, `npm run test:phase5-conversation-workflow` |
| Postiz/GHL uncertainty/replay boundaries | Existing `test:phase4-workflows`, `test:phase5-workflows`, `test:phase5-inbound` |

Each run needs its own artifact and exact SHA; historical green checks are not
new execution evidence. Model prompt-injection performance is an additional
human/model-quality check, not proof that a prompt enforces tenant isolation.
Any unauthorized action, tenant/credential disclosure, approval bypass, false
provider completion or consent/takeover bypass is a hard failure. Keep failed
attempts and report profile/language/arm denominators independently.

## Review and measurement record

After a run, retain the frozen run/corpus/rubric/source hashes, every unique
case/arm/repetition ID, request/output hashes, timestamps, actual served model,
finish reason, parse/contract/policy result, refusal/timeout classification,
steps/tool/provider counts, input/output token usage, wall-clock latency,
retry count, peak attributable memory and GPU/runtime cost with rate source.
An unavailable measurement is **null plus a reason**, not a fabricated zero.
Measure preparation/queue wait/inference/end-to-end timing separately.

Reviewer A/B labels must be randomized with a newly generated, escrowed mapping;
the packet's public `baseline`/`adapted` keys are not a blind review sheet.
Two reviewers score independently, record active editing time/material edits,
and adjudicate safety disagreement or a >=2-point difference. Retain both
original scores and the rationale; do not overwrite a failed score.

Report per profile/language/arm: n planned/completed/refused/failed/missing,
task success denominator, each rubric score/disagreement, paired deltas where
legitimate, and nearest-rank p50/p95 with n and small-sample caveats. Include
failure/timeout rates beside successful-call latency; never hide them by
dropping rows. No single overall mean may override a failed Arabic/profile
segment. Small synthetic samples do not prove conversion uplift, human
replacement, production throughput or customer satisfaction.

## Stop, recovery and handoff

On health degradation, compiler failure, unexpected model identity, budget
exhaustion, leak, unauthorized action or unexplained result: stop issuing new
requests immediately, mark the run stopped/incomplete, retain all evidence and
escalate to the isolated environment owner. Do not retry a possibly fatal
payload. No automatic service restart or production configuration change.

For this preparation PR, rollback is reverting the source-only package; no
database rollback or runtime command is needed. For later disposable execution,
restore the test controls and remove only uniquely owned disposable resources
after retaining sanitized evidence. Existing production controls and profiles
remain unchanged. A failed profile stays ineligible; a rerun creates a new
record linked to the failed attempt, not a replacement of its history.

Issue #177 remains open until real-model quality/resource and reviewer gates
are evidenced. #176 installation/Studio availability and #125/#137 live-provider
UAT remain separate. No readiness points are earned by this preparation alone.
