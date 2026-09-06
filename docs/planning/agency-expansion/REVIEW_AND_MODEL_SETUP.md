# Agency pilot: people, model environment and next acceptance gate

As of 2026-09-06. Owner: [#177](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/177).
Status: Tamer selected CPU VPS `155.117.45.45` for disposable test services and
the existing shared Gemma 4 for inference. No second GPU is required. Human
nominations, the concrete resource/transport package and execution approval
remain pending. This document changes no frozen input.

## What is accepted

Tamer delegated Tanaghom PR technical reviews to Codex. PR #198 was reviewed
and merged at `9fde3aa673f4bc634c36bab00957cbf7f84ebd91` after all 40 checks
passed on its exact head. The accepted scope is the authenticated, disposable
**simulator**, not real Gemma evaluation or deployment. See the
[dated review record](../../evidence/2026-09-06-agency-pr-review-and-setup.md).

Delegated code review does not appoint Codex as the customer's business
authority, approve a rubric, purchase GPU time, or authorize production work.
Source author and technical reviewer are the same coding agent; this is not
independent human/security review. Existing protected-branch requirements must
still be respected, never bypassed using administrator privileges.

## People: a practical proposal

| Responsibility | Proposed person | Status |
| --- | --- | --- |
| Code/PR review, automated tests, evidence preparation | Codex | Delegated by Tamer; no independent-review claim |
| Product scope and release decisions | Tamer | Existing product owner; no new release signoff recorded |
| Correct offers, prices, policies and reference answers | Customer sales/support manager, or Tamer if he owns these decisions | Nomination pending |
| Independent English/Arabic answer ratings | Tamer plus one bilingual customer representative | Proposed, not nominated or approved |
| CPU test services, shared Gemma inventory and resource/request window | Operators designated by Tamer | CPU VPS selected and inspected read-only; model metadata and execution window pending |

The business approver can also be one of the two answer reviewers. These are
people reading answers, not new technical accounts or API credentials. Two
independent bilingual reviewers are the existing **proposed** rubric. If the
pilot must use a different arrangement, explicitly approve a successor rubric
and record its limitation before seeing model results; do not quietly fill two
fields with the same person or count Codex as a second human.

The one customer question is: **Who should confirm that the answers follow
the customer's real offers, prices and policies?** A role is enough initially.
Example reply: "I will review them with our customer's support manager; I will
provide the manager's name later." This nominates roles only, not a pass score.

## What answer review looks like

The following is an authored illustration, **not a generated answer, approved
reference answer, customer policy or scored evaluation case**.

Suppose a fictional course brief does not include a refund policy. A customer
asks for a refund. An appropriate answer would acknowledge the missing policy
and require human review; it must not pretend a refund has been approved.

- English illustration: "I cannot confirm refund eligibility from the available
  policy information. A member of the team needs to review your request."
- Arabic illustration: "لا يمكنني تأكيد أهلية استرداد المبلغ من معلومات السياسة
  المتاحة. يلزم أن يراجع أحد أعضاء الفريق طلبك."
- Hard-failure illustration: "Your refund is approved and will arrive tomorrow."
  There is no policy or executed action supporting that promise.

Review procedure:

1. Before model outputs exist, approve the business facts, permitted claims,
   reference answers, scenario coverage, rubric and proposed thresholds.
2. Nominate reviewers and a person to resolve disagreements. Confirm both
   reviewers can assess English and Arabic meaning, not just grammar.
3. Have an authorized reviewer hold the genuine withheld cases and fresh blind
   label mapping in restricted storage. Public corpus/reserve cases are not
   hidden. Do not put customer material or the mapping into public GitHub.
4. After a separately approved run, each reviewer reads the same frozen task,
   approved evidence and anonymized A/B outputs independently. Brand Guardian
   and Executive Summary use reference checks, not a fabricated AI baseline.
5. Record usefulness, factual grounding, language/tone and appropriate
   escalation using the full [0-4 anchors](../../../evaluation/agency-v1/rubric.json).
   Also record hard failures, correction time and the reason for each rating.
   Missing ratings/times are null, never assumed passes or zero effort.
6. Preserve original ratings. Resolve any hard-failure disagreement or a
   difference of two or more points with a recorded explanation. Report by
   profile and language; an overall average cannot hide a failed Arabic case.
7. Tamer and the designated business approver decide whether the evidence meets
   the agreed scope. Code merge, a simulation pass and a completed form do not
   constitute that release decision.

Copyable review row (leave fields blank until real review):

```text
Run/corpus/rubric version:
Case ID / profile / language / repetition / blind output label:
Reviewer ID / review time:
Usefulness (0-4):
Groundedness (0-4):
Language and tone (0-4):
Escalation (0-4):
Hard failure, or none:
Evidence supporting the rating:
Correction time and material changes, or not measured:
Disagreement/adjudication reference, if needed:
```

## Selected topology: CPU test services and existing shared Gemma

Tamer's subsequent direction supersedes this PR's initial proposal for a
separate non-production GPU: use **CPU VPS `155.117.45.45`** for the test harness,
disposable database and n8n, and use **existing shared Gemma 4** for inference.
There is no second GPU purchase or model installation in this plan.

This isolates **test state**, not the model process or all host resources.
Shared inference can affect other work, and a schema/compiler failure can still
harm the shared engine. Quality results must identify the shared endpoint;
latency/resource observations cannot be presented as isolated GPU capacity or
attributable per-run memory without appropriate measurements.

The original frozen `evaluation/agency-v1` and `evaluation/agency-runner-v1`
packages remain unchanged and still prohibit ad hoc shared-model retargeting.
Prepare a **reviewed successor execution manifest and transport package** that
explicitly records this topology, its changed risk boundary, matching compiler
evidence, model identity and operator-approved request window. Do not populate
the original isolated-environment approval field with this CPU host or claim
its old model-isolation gate has passed. Selecting the topology is not
authorization to run new structured-output schemas against shared Gemma.

The [read-only VPS inventory](../../evidence/2026-09-06-cpu-vps-readonly-preflight.md)
found 3 CPUs, 5,925 MiB RAM (3,307 MiB available in that snapshot), and about
40 GB free root disk. It also found 21 existing containers, including four
unhealthy/restarting containers. This is **not an empty or dedicated test host**.
Their causes were not investigated; none was changed. The Hybrid application,
Postiz and other existing workloads are not the certified Tanaghom environment.
Never reuse their databases, vaults, credentials, ports or volumes.

Before startup, the successor package must demonstrate an aggregate CPU/RAM/
disk budget with host headroom, bounded logs/evidence, unique resource names,
non-conflicting ports/networks, run-owned cleanup and stop conditions. Build
artifacts off-host where practical. The accepted CI runner's PostgreSQL and
n8n alone allow 512 MiB + 1,536 MiB and 1 + 2 CPUs, before dashboard/gateway
overhead; copying those limits to this shared 3-CPU VPS is not a capacity plan.
Keep the CI simulator's host networking/disabled SSRF settings out of the shared
VPS design. Use a reviewed isolated test network, authenticated private test
services and a fixed TLS-verified Gemma route; no arbitrary outbound URLs,
provider credentials or public test UI/webhooks. Host firewall changes, if
needed, require a separately reviewed exact diff and rollback, not this note.

No SmartLabs, SmartCC, voice or Gemma service may be reconfigured, restarted or
provisioned by this work. No infrastructure purchase is authorized.

The existing Linux CI runner proves PostgreSQL/n8n/authentication using a local
simulator; it neither supplies a GPU nor certifies a real model. The Windows
workstation lacks the required container-to-host loopback path and is not the
real-model test target. Do not restart Docker to enable it during this work.

Ask the environment owner for a secret-free inventory and approval reference:

| Required fact | Why it is needed |
| --- | --- |
| CPU host identity, operator, resource caps and disposable-state boundaries | Confirm run-owned resources and protect co-hosted workloads |
| Shared Gemma operator, approved endpoint and request window | Explicitly accept shared inference risk without administration rights |
| GPU allocation/headroom and existing health/stop signals | Bound request load; unknown measurements remain unknown |
| Exact served model ID and immutable model-file manifest/digests | An alias such as Gemma is not a reproducible model identity |
| Tokenizer and chat-template digests, quantization and context limit | Match prompt formatting and verify prompt plus output fits the context |
| Immutable inference image/build, vLLM/xgrammar versions, backend and launch configuration | Match the actual serving installation, including non-container installations |
| Supported sampling and seed parameters | Record actual behavior without promising deterministic output |
| Fixed TLS-verified Gemma route, credential reference and reviewed network boundary | Only the selected inference API, never unrelated private services or provider endpoints |
| Approved CPU/RAM/disk/time/request budget and cost basis | Existing compute is not assumed free or unlimited; no extra GPU purchase |

Use existing operator/release records where available. This is a request for
information, not permission to inspect or hash files on a protected live host.
Never put keys, tokens, session files or customer data in the inventory.

vLLM's current documentation describes configurable structured-output backends
and version-dependent request fields. The implementation must target the
**pinned test version**, not silently adopt the latest documentation's defaults
or change the existing production request contract.
[Primary vLLM documentation](https://docs.vllm.ai/en/latest/features/structured_outputs/).

XGrammar exposes a separate tokenizer-aware schema compilation step with CPU
preprocessing. This supports a CPU-side compiler compatibility check using the
matching approved package/tokenizer/configuration, without loading a second
GPU model. It is not proof that the complete shared vLLM service cannot fail.
[Primary XGrammar workflow](https://github.com/mlc-ai/xgrammar/blob/main/docs/start/workflow_of_xgrammar.md?plain=true).

## Ordered test gates and proposed limits

These limits carry forward the proposed rubric; they do not grant execution
authority. The CPU/shared-model topology is selected; concrete capacity limits,
the successor transport, shared-model window and reviewer approvals are missing.

1. **Inventory and freeze:** approve the people, data/reference/withheld plan,
   model identity, shared-inference risk, schema hashes and absolute budgets.
   Preserve the accepted simulator and its two source locks unchanged.
2. **Implement the separate real-model transport/compiler package:** fixed
   destination, manifest-bound model/case/arm, no arbitrary prompts/URLs,
   authenticated durable jobs, request/body/time/token limits, reviewed read-only
   health checks and operator stop procedure. This package is not implemented by this
   setup document. The simulator cannot be switched to live by a flag.
3. **Compiler-only gate:** test the four actual strategy/content/conversation/
   Brand schemas in a bounded CPU-only matching compiler environment. Record
   schema/image hashes, exit codes, bounded logs and resource use. A JavaScript
   schema screen is not this compiler test. No model inference yet.
4. **Separately authorized shared-Gemma smoke gate:** at most eight requests
   (four schemas, English/Arabic), one outstanding request, zero automatic
   retries, at least five seconds between requests, 90-second request timeout.
   Check approved model identity/health signals before and after each request.
   A timeout does not prove server-side generation stopped: halt the batch and
   require operator confirmation before any further inference. Any failure
   stops new requests; do not restart a failed engine or replay a fatal schema.
5. **Review smoke evidence, then authorize the quality run:** the existing
   public plan is 324 model attempts plus 36 deterministic reports, with three
   predetermined repetitions and no automatic retries. The eight smoke calls
   are separate: 332 model calls in total before any newly approved hidden set.
   Output allowance is at most 8,000 tokens per attempt, not a usage forecast;
   tokenize with the pinned tokenizer and check input plus output context fit.
   A 14,400-second run ceiling may stop an incomplete run; it does not promise
   that all attempts finish. Keep failures and missing cases in the denominator.
6. **Human review and decision:** assess real outputs, resource measurements,
   failures and per-language results. Keep #177 open until its acceptance
   evidence is complete. #176 installation and #125/#137 provider UAT remain
   separate. All provider actions remain forbidden throughout this experiment.

On uncertainty, health loss, identity/schema drift, a limit breach or an
unauthorized action: stop new requests, retain evidence and notify the relevant
CPU/model operator. Cleanup may remove only run-owned resources after evidence
retention. It must never restart or modify shared production services.

## Current decision record and next step

- Confirmed: Codex may conduct Tanaghom technical PR reviews; #198's source
  simulator acceptance is complete. Tamer selected the CPU VPS plus existing
  shared Gemma topology; a read-only CPU-host inventory is recorded.
- Proposed only: Tamer plus a bilingual customer colleague for answer review,
  the successor resource/network/transport design and bounded sequence above.
- Missing: business reviewer nomination, approved reference/withheld/rubric
  material, model inventory/operator request window and resource authorization.
- Not authorized/performed: remote provisioning/changes, real-model inference,
  provider action, workflow activation, deployment or customer release signoff.

Best next move: prepare the controlled CPU-VPS resource/network package and
successor shared-Gemma transport using existing approved model records. Obtain
missing operator metadata/window before compiler or model execution; collect
the business-reviewer nomination in parallel. No new GPU or provider credential
is needed for source preparation. Production-release evidence remains **60/100**
under the unchanged [scorecard](../../PRODUCTION_READINESS.md).
