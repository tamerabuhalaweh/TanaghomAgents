# Isolated authenticated comparison runner: implementation and evidence

Scope: #177. Accepted predecessor PR #197:
`7317b2e085f0b80d12bc0fb2c862d247716600a9`, 39/39 CI checks passed.
Authorization covers implementation and disposable simulated-response testing,
not live Gemma, deployment, workflow activation or customer certification.

## Implemented

- Actual owner-JWT API queueing and restricted-worker RPC execution.
- Fixed baseline/adapted selection from an immutable run/case/arm/repetition
  record. No new arbitrary-prompt API or changed production endpoint.
- Resolved database material checked against the frozen fictional test case;
  comparison conditions preserve every business/evidence input, normalizing
  only independent task/correlation IDs and the intended system-arm difference.
- 360 planned durable attempts: 144 baseline/adapted pairs, 36 Brand attempts,
  36 deterministic reports. These require 324 simulated model HTTP responses.
- Bounded manual n8n batches of at most 30, inactive with no schedule, explicit
  stops and append-only completion evidence. Original migrations and workflow
  exports remain unchanged; isolated SQL is not a production migration.
- Version-pinned runner source, unique pass/fail artifact retention and a
  reviewer/model checklist that cannot grant execution authority.

Technical details, exact commands, boundaries, reviewer explanation and
rollback: [runner runbook](../../evaluation/agency-runner-v1/RUNBOOK.md).

## Validation layers

Local unit tests: **166 passed**. Repository check and dashboard typecheck pass.
The original 47-file preparation lock and its prior evidence still validate.
The new CI job executes the actual n8n/PostgreSQL comparison runner; the
introducing PR's checks and uploaded unique artifacts are authoritative for
the exact reviewed source head. Do not substitute an earlier local artifact.

The local development sequence retained failures rather than erasing them:
missing strategy linkage and duplicate trigger-created conversation fixtures
were corrected. An initial full single-execution batch passed, but later
long-loop CLI runs stopped at 186 and 338 queued tasks without sufficient
diagnostics to establish their root cause. A bounded run also encountered a
completion HTTP-node failure; a subsequent bounded run and the first CI runner
passed. A later Windows run at `b844197` aborted the Claim HTTP request after
41 successful attempts (`ECONNABORTED`); connection closing alone did not resolve
the intermittent local failure. The same commit passed all 40 Linux CI checks,
including the complete comparison job:
[run 34035128865](https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34035128865).
The subsequent diagnostic local run `0519f865195b` passed all 360 attempts and
six negative controls. These observations do not establish the transport fault's
root cause or prove Windows repeatability. No failed attempt is retried silently
or counted as successful.

The final runner retains stage/CLI diagnostics, failed attempt state and bounded
request-receipt/response-close diagnostics; each manual n8n batch is limited to
30. Only the final source head's CI evidence can establish its acceptance.

Each run stores `tmp/tanaghom-quality-<run>-evidence.json`; CI uploads these even
on failure. The latest-result pointer is replaceable; the unique history is
not. No real-model token/cost/memory or human-quality score is fabricated.
Simulated response usage fields and gateway timings are labeled test transport
measurements, not real-model or production performance.

## Remaining gates

The customer/domain reviewer and two proposed bilingual reviewers are not yet
designated. Tamer asked for clarification: these are people reading sample AI
answers for business correctness and language quality, not API credentials or
technical accounts. No signoff has been recorded on anyone's behalf.

Before real testing: approve rubric/reference/withheld material and reviewers;
pin the approved isolated model weights/tokenizer/template/runtime/compiler;
review the separate real-model transport and bounded compiler/probe package.
The current runner accepts only its local simulator. No shared production
Gemma endpoint can be selected by a flag, environment variable or checklist.

#177 stays open for actual model-quality/resource evidence and reviewer
acceptance. #176 installation/Studio availability and #125/#137 provider UAT
remain separate. **Production-release evidence: 60/100, unchanged** under the
[existing scorecard](../PRODUCTION_READINESS.md); not feature completion.
