# Tanaghom status and next work

**As of 2026-09-06: new test-VPS deployment authorized; certified 38.247 unchanged.**
Tamer reformatted CPU VPS 155.117.45.45 and authorized a public HTTPS test
installation under #200. He subsequently accepted pinning its replacement SSH
key without a provider console; this is not independent identity verification.
The host is freshly inspected, empty and healthy; old incident records are
historical. The new package uses an isolated local business database and existing
Supabase owner sign-in, not production data or the Supabase admin key.
Deployment completion/evidence is pending. No model/provider execution,
n8n activation or changes to certified 38.247/SmartLabs/SmartCC are authorized.
Start here: [developer context](PROJECT_CONTEXT.md).

## Executive state

Tanaghom has implemented campaign/content, approvals, customer integrations,
conversation governance, skills, Agent Studio and the shared policy runtime.
Its initial commercial pilot remains separate from full live-provider
acceptance. The expansion now has six source candidates plus four callable
simulation bindings and two bounded local adapters, now connected to an authenticated
owner API, canonical database resolver, durable audit and a new inactive n8n pilot
export. Twelve disposable bilingual n8n/database round trips pass. Production
installation, Studio availability and real-model quality certification remain unfinished.

The accepted source baseline is now
`9fde3aa673f4bc634c36bab00957cbf7f84ebd91` (PR #198; 40/40 exact-head CI checks passed).
The original pre-expansion baseline was `0b5b5a7` (PR #173). Neither source merge
nor local adapter simulation establishes what is currently deployed.

## Evidence layers

| Layer | Verified fact or limit | Source |
|---|---|---|
| Source baseline | 34 up/down migration pairs through 0034; eight business + six shared runtime exports plus the separate inactive Agency pilot export | Repository at the baseline SHA |
| Foundation issue state | #132, #133, #134 and #135 are closed implementation slices | [Pre-expansion issue snapshot](evidence/2026-09-06-pre-expansion-github-issues.json) |
| Historical Studio certification | 14/14 canonical English/Arabic simulation scenarios recorded; agent stayed validated, zero provider actions | [2026-07-27 #137 evidence](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/137#issuecomment-5095194632) |
| Last reviewed deployment record | PR #173 deployed at 0b5b5a7; migration 0033; dashboard health/boundaries passed then | [2026-07-28 #125 evidence](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/125#issuecomment-5104583814) |
| Current certified server/provider health | Not checked by this planning task; July records are historical | Fresh authorized preflight required |
| Selected CPU test host | Tamer subsequently reformatted 155.117.45.45; fresh inspection: 3 CPUs, 5,925 MiB RAM, ~96 GB free disk, no failed units or containers. #200 deployment in progress | [Fresh test package](../deployment/fresh-test-vps/RUNBOOK.md); earlier [pre-format inventory](evidence/2026-09-06-cpu-vps-readonly-preflight.md) is historical |
| New expansion | Six candidates; four callable simulation bindings; Brand precheck/semantic proposal and grounded report adapters; none installed, model-certified or activated | [Runtime package](../packages/agent-runtime/README.md) |
| Accepted integration slice | Migration 0034, JWT/owner API, separate gateway role, inactive pilot export; 12 actual disposable n8n journeys, 10 stub-model HTTP calls, zero real model/provider calls | [Authenticated integration](architecture/0019-authenticated-agency-pilot.md) |
| Accepted preparation slice | #177: 48 core + 24 public reserve cases; six profiles in EN/AR; pinned paired requests and proposed rubric; no blind holdout or actual model-quality result | [Evaluation preparation](../evaluation/agency-v1/RUNBOOK.md) |
| Accepted runner slice (PR #198) | 360 successful simulator attempts in exact-head Linux CI; 167 local tests; verified loopback prerequisite replaces unsupported Windows fallback; no live model transport | [Accepted review and evidence](evidence/2026-09-06-agency-pr-review-and-setup.md) |

**Production-release evidence score: 60/100; NO-GO for customer production.**
This is the new explicit [20-gate scorecard v1](PRODUCTION_READINESS.md), not a
feature-completion percentage or a reuse of historical 92–98% estimates. Twelve
source/isolated-test gates are evidenced; eight current-runtime/customer gates
need fresh evidence. New profile source tests do not earn production points.

The historical certification record did not establish that every scenario used
a live model: its controlled resume included six direct jobs and zero model
jobs. Do not claim that it proves current Gemma capacity or new-profile quality.

## Current release blockers: existing lane

**Dependency remediation:** [#192](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/192)
tracks the original audit failure and its patch-only source fix in PR #193.
The original planning changes did not introduce these dependencies. The fix
updates fast-uri, PostCSS and Nano ID without changing Next.js or the audit
threshold. Clean local install/audit (zero findings), 115 tests, typecheck,
root-launched production build and three Chromium access-boundary tests pass.
See [exact remediation and CI evidence](evidence/2026-09-06-dependency-audit-remediation.md)
and PR #193: all 38 CI jobs passed; merged as
`91fa3a4411dc6e4fbcbc8f9d125f26659569ce9a`. #192's source scope is complete.
Deployment remains a separate gate;
this source fix does not establish that production is patched.

Do not treat credentials as the only definition of done. Latest historical
provider evidence still required credentials/channel/contact setup plus
actual execution and customer acceptance. Refresh these facts before action:

| Work | Canonical owner | What remains to verify/complete |
|---|---|---|
| Customer delivery acceptance | #125 | Agreed scope, complete journeys, classified defects and written signoff |
| Postiz draft handoff | #45 | Certified-vault credential, supported mapped staging channel, one draft/replay/no-publish evidence |
| GHL actions | #54 | Exact scopes, signed webhook path, allowlisted test contact, consent/templates and approved Assisted evidence |
| Human supervision | #53 | Complete remaining acceptance including takeover/no-double-send under real bounded journey |
| Quality and rollout | #56 | Customer-approved baseline/thresholds and bounded Shadow/Assisted evidence |
| Agent Studio rollout certification | #137 | Simulation evidence exists; remaining test-account Shadow/Assisted gates remain open |
| Browser/Arabic/RTL acceptance | #14 | Remaining agreed customer/browser evidence; no claim of all screens complete |
| Performance, capacity and notifications | #46 / #55 | Check each issue's remaining acceptance; configuration is not delivery proof |

Do not use this table as authority to clear stops or activate provider workers.

### Known repository caveats

- Overview still has a disabled Create campaign entry point and stale phase
  copy in `apps/dashboard/components/overview-dashboard.tsx`; the implemented
  Campaigns lifecycle is separate. This planning task does not fix UI.
- Notification destinations/monitoring are implemented, but ADR 0011 explicitly
  excludes the delivery worker from that slice. Do not promise working alert
  delivery solely because a destination can be saved.
- Generic Studio live promotion, enabled adapters, provider dispatch and
  customer acceptance remain separate from simulation certification.
- Older roadmap/issue prose may still say a completed foundation is not started.
  Read the evidence/date and latest reconciled status; preserve historical
  comments rather than presenting them as current facts.

## Expansion lane: plan approved, selected pilot source work authorized

- **#174**: all-department epic.
- **#175**: six selected source reviews complete; 267 reviews still pending.
- **#176**: six-profile pilot (strategy, content, brand review, discovery,
  customer care, executive reporting): authenticated database/n8n integration
  implemented and tested in disposable environments; production installation,
  Studio availability and model/customer acceptance remain open.
  [Integration evidence](evidence/2026-09-06-agency-authenticated-integration.md).
- **#177**: paired bilingual evaluation preparation implemented: 72 synthetic
  cases, 47 source pins, proposed rubric and non-executable attempt ledger.
  The isolated authenticated fixed-baseline runner is now implemented with a
  full 360-attempt simulator test. Actual matching compiler/model evidence,
  real-model transport approval, reference answers, blind holdout and reviewer
  acceptance remain pending. Not model-certified.
  [People and CPU/shared-Gemma setup](planning/agency-expansion/REVIEW_AND_MODEL_SETUP.md)
  records Tamer's selected topology and unfilled customer/model approvals.
  A successor manifest must explicitly replace the original isolation design;
  frozen packages stay unchanged and cannot be retargeted by a setting.
- **#178**: bounded team assignments on existing runtime handoffs.
- **#179**: team onboarding/operations UX.
- **#180**: governed improvement proposals.
- **#181-#190**: complete department coverage, including restricted-domain gates.

Existing #150 Hermes, #151 older flow-pack intake, #152-#155 commercial skill
tracks, #136/#156 MCP, and #157 video retain their ownership. No duplicate
Hermes or analytics executor is being introduced.

## Next best move and authority

Immediate authorized work is #200: deploy and validate the public isolated test
dashboard from [the new package](../deployment/fresh-test-vps/RUNBOOK.md), with
all model/provider actions disabled. This supplies a test UI, not full automated
agent UAT; invitations are unavailable without a separately scoped auth admin key.

#192's source fix, planning PR #191, candidate PR #194, kernel PR #195 and
authenticated integration PR #196, preparation PR #197 and simulator PR #198
are accepted. #198 passed all 40 exact-head CI checks. Tamer delegated Tanaghom
technical PR reviews to Codex; code review does not replace business acceptance.
Next prepare/review the controlled CPU-VPS resource/network package and successor
shared-Gemma transport. Use approved model records, obtain missing compiler/model
metadata and the operator request window, and collect the business-reviewer
nomination in parallel. The VPS was inspected only; no test services were started
and its unrelated unhealthy/restarting containers were not investigated or changed.
See the linked setup proposal for review examples, bounds and remaining decisions.
The prerequisite checker cannot grant authority. No live model/provider call
or remote configuration change is part of this work. Keep every candidate
unavailable until its actual installation/dependency/certification gates pass.
Full source review of the other 267 profiles is a later roadmap task, not a
pilot start blocker. No new customer credential is needed for this source work.

PR #44 was also reviewed. Its July-only deployment report is not in current
main; it stays open pending refresh, current checks and explicit historical
labeling. It is not evidence of today's server health and does not block #177.

Keep #125/#45/#54/#56/#137 provider acceptance on its separate critical path;
new templates are not a substitute for those tests.

No developer may infer authority to modify SmartLabs, SmartCC, voice, Gemma
services, credentials, firewall, Nginx, n8n activation or customer/provider
state from the expansion approval.

## Status maintenance

Update this file with each material change. Name the source commit, evidence
date and exact completion gate. A live issue is current work coordination;
its versioned snapshot and PR evidence are the recoverable history. Do not
reuse an old percentage as a new production-readiness measurement. Use the
versioned scorecard and distinguish unknown runtime evidence from a broken feature.
