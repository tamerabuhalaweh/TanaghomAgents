# Agency pilot: people, model environment and next acceptance gate

As of 2026-09-06. Owner: [#177](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/177).
Status: setup proposal; human nominations, model environment and execution
approval remain pending. This document runs nothing and changes no frozen input.

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
| Isolated GPU environment, exact model inventory and resource limits | Environment owner designated by Tamer | Unknown; no host access performed |

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

## Recommended isolated model setup

Use a separately approved **non-production Linux GPU environment** under a
named operator. Its GPU/model process, database, credentials, queues and test
network must be isolated from customer workloads. A second container on the
same busy production GPU is not an accepted isolation plan. Do not use the
shared 38.247 Gemma endpoint, modify SmartLabs/SmartCC/voice, or transplant the
Hybrid environment's credentials. No infrastructure purchase is authorized.

The existing Linux CI runner proves PostgreSQL/n8n/authentication using a local
simulator; it neither supplies a GPU nor certifies a real model. The Windows
workstation lacks the required container-to-host loopback path and is not the
real-model test target. Do not restart Docker to enable it during this work.

Ask the environment owner for a secret-free inventory and approval reference:

| Required fact | Why it is needed |
| --- | --- |
| Environment identifier, operator and isolation evidence | Know where a failure is contained and who may stop it |
| GPU device/allocation, available VRAM/RAM/disk, absolute limits | Prevent borrowing unknown shared capacity; no guessed minimum GPU size |
| Exact served model ID and immutable model-file manifest/digests | An alias such as Gemma is not a reproducible model identity |
| Tokenizer and chat-template digests, quantization and context limit | Match prompt formatting and verify prompt plus output fits the context |
| Immutable inference image, vLLM/xgrammar versions, backend and launch configuration | Test the compiler/runtime actually intended for the candidate |
| Supported sampling and seed parameters | Record actual behavior without promising deterministic output |
| Private test route, credential reference and reviewed network boundary | Fixed isolated destination; no production fallback or public ingress |
| Approved GPU/RAM/disk/time/request budget and cost basis | Self-hosted compute is not assumed free or unlimited |

Use existing operator/release records where available. This is a request for
information, not permission to inspect or hash files on a protected live host.
Never put keys, tokens, session files or customer data in the inventory.

vLLM's current documentation describes configurable structured-output backends
and version-dependent request fields. The implementation must target the
**pinned test version**, not silently adopt the latest documentation's defaults
or change the existing production request contract.
[Primary vLLM documentation](https://docs.vllm.ai/en/latest/features/structured_outputs/).

## Ordered test gates and proposed limits

These limits carry forward the proposed rubric; they do not grant execution
authority. Concrete memory, cost, host and reviewer approvals are still missing.

1. **Inventory and freeze:** approve the people, data/reference/withheld plan,
   model identity, isolated environment, schema hashes and absolute budgets.
   Preserve the accepted simulator and its two source locks unchanged.
2. **Implement the separate real-model transport/compiler package:** fixed
   destination, manifest-bound model/case/arm, no arbitrary prompts/URLs,
   authenticated durable jobs, request/body/time/token limits, isolated health
   checks and operator stop procedure. This package is not implemented by this
   setup document. The simulator cannot be switched to live by a flag.
3. **Compiler-only gate:** test the four actual strategy/content/conversation/
   Brand schemas inside the approved matching compiler environment. Record
   schema/image hashes, exit codes, bounded logs and resource use. A JavaScript
   schema screen is not this compiler test. No model inference yet.
4. **Separately authorized smoke gate:** at most eight isolated model requests
   (four schemas, English/Arabic), one outstanding request, zero automatic
   retries, at least five seconds between requests, 90-second request timeout.
   Check isolated model identity/health before and after each request. A failure
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
unauthorized action: stop new requests, retain evidence and notify the isolated
environment owner. Cleanup may remove only run-owned resources after evidence
retention. It must never restart or modify shared production services.

## Current decision record and next step

- Confirmed: Codex may conduct Tanaghom technical PR reviews; #198's source
  simulator acceptance is complete.
- Proposed only: Tamer plus a bilingual customer colleague for answer review;
  separate non-production Linux GPU setup and the bounded sequence above.
- Missing: business reviewer nomination, approved reference/withheld/rubric
  material, isolated operator/target/model inventory and resource authorization.
- Not authorized/performed: host connection, provisioning, real-model inference,
  provider action, workflow activation, deployment or customer release signoff.

Best next move: obtain the single business-reviewer nomination and the isolated
environment owner's inventory, then review the concrete compiler/transport
package against those facts. Do not substitute another planning approval for
missing runtime evidence. Production-release evidence remains **60/100** under
the unchanged [scorecard](../../PRODUCTION_READINESS.md).
