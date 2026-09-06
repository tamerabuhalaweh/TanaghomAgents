# Production release evidence scorecard v1

As of 2026-09-06. **60/100 evidenced release-gate coverage; production NO-GO.**
This is an internal delivery checklist, not a claim that only 60% of features
exist or a customer-approved release decision. It replaces incomparable historical
92–98% estimates with an explicit denominator. No product regression is implied
by changing the measurement method. Source work alone cannot verify a live host.

## Scope and scoring rule

Scope: the existing sales/content/marketing pilot and its human-controlled
Postiz/GHL customer journey. The 273-profile future expansion, Hermes, video and
new departments are excluded. Adding the new six-profile pilot to a customer
release requires a recorded scope decision and its own #176/#177 acceptance;
its source tests do not increase this existing-product score.

Twenty named gates, five points each. A gate receives five only with evidence
for its stated layer; pending/unknown receives zero, not an invented partial
credit. Historical production records remain useful history but do not satisfy
a current-release runtime gate. Hard gates cannot be traded for more code points.
The score is **not a probability of success or feature-completion estimate**.

## Source and isolated-test evidence: 60/60

Baseline: PR #195, merged as `ec0058e48a3b64d3c43a94e25638b4d569d82ba8`,
38/38 CI checks green. These points describe source/isolated test evidence only.
New adapter implementation gets no extra production points for passing local tests.

| Gate | Evidence layer | Points |
| --- | --- | --- |
| Reproducible repository/build checks | repository, dashboard and image CI | 5 |
| Patch dependency audit | PR #193 source fix and zero-findings audit; not deployed proof | 5 |
| Authentication and team access | dashboard API/access boundary and database CI | 5 |
| Tenant/role least privilege | database contract and executor-role tests | 5 |
| Campaign lifecycle and approval lineage | campaign lifecycle/canary contract CI | 5 |
| Customer-managed integration vault and policy | API/database/provider-readiness contract CI | 5 |
| Queue retry, idempotency and failure boundaries | workflow/resilience/dependency-loss CI | 5 |
| Structured worker input/output contracts | Phase 3/4/5 and agentic simulation CI | 5 |
| Skills, Studio and shared runtime governance | Phase 7 library/Studio/executor certification CI | 5 |
| Human action authorization boundaries | conversation/action contract and API/database CI | 5 |
| Retention/recovery/capacity tooling | disposable retention/recovery/capacity CI; not host sizing proof | 5 |
| Reversible update/quality evidence tooling | deployment-package/quality-shadow contract CI | 5 |

## Current-release and customer evidence: 0/40 credited

Zero means **not currently evidenced here**, not necessarily broken. The latest
reviewed certified-host record is July 28. The additional rebuilt CPU test
deployment has [fresh evidence](evidence/2026-09-06-fresh-test-vps-deployment.md),
but does not establish the certified runtime's health, recovery, model/provider
acceptance or customer signoff. Its manual UI/API checks earn no extra points
on this existing-production scorecard.

| Required release gate | Remaining work | Points |
| --- | --- | --- |
| Fresh deployed baseline and security | Verify exact commit/migrations, health, patched dependencies, boundaries and recovery for the proposed release | 0/5 |
| Real-model bilingual journey | Exact served model/schema, approved knowledge, English/Arabic results and human review for the release | 0/5 |
| Postiz staging acceptance #45 | Mapped supported channel, one draft, replay/no duplicate, no publication | 0/5 |
| GHL staging acceptance #54 | Exact scopes, signed ingress, consented test contact, approved action, provider evidence and restored stops | 0/5 |
| Live human-supervision acceptance #53 | Takeover/pause/resume and no-double-send authority-race evidence | 0/5 |
| Quality and bounded rollout #56/#137 | Customer baseline/thresholds and accepted Shadow/Assisted mode | 0/5 |
| Operational delivery #46/#55 | Agreed capacity envelope and tested required alerts; notification setup alone is not delivery | 0/5 |
| Final customer UAT #125/#14 | Agreed browser/mobile/Arabic scope, classified defects, retests and written signoff | 0/5 |

Source: [current delivery gate](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/125),
[certification gate](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/137),
and [reconciled status](STATUS.md). Current issue bodies were read on this date.

## How to improve the score

Keep this denominator stable for the existing pilot. Record date, exact release,
command/result or customer evidence and owner for each newly passed gate. A stale,
failed or materially changed gate loses credit with a stated reason. If scope
changes, version this scorecard and explain the change instead of silently moving
the percentage. A separately authorized production/provider preflight and bounded
customer journey are the highest-value way to obtain missing release evidence.
Credentials are necessary inputs to some gates, not a substitute for passing them.
