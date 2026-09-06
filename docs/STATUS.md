# Tanaghom status and next work

## Latest authorized delivery: cooperating specialist workspace

Tamer authorized implementation and test deployment of a customer-visible
specialist/team journey on 2026-09-06. Work is tracked under #176/#177/#178/#179:
[delivery scope](planning/agency-expansion/WORKSPACE_DELIVERY.md),
[update and rollback](../deployment/agency-workspace/RUNBOOK.md).
New source adds `/workspace`, migration0035, five document-generating specialists
plus a deterministic delivery summary, shared versioned task context and exact
human decisions. It does not make the frozen Agency simulator a live worker.
The workspace update is deployed at `369525f8fdf4dcd494ad09c50bde727237e23d89`
on the isolated test VPS, with0035 and the private n8n dispatcher imported
inactive. Dashboard/PostgreSQL/n8n health, HTTPS, private authentication and public
blocking checks passed; there are zero workspace assignments and zero n8n
executions. See [deployment and rollback evidence](evidence/2026-09-06-agency-workspace.md)
and the [new customer walkthrough](testing/AGENCY_WORKSPACE_GUIDE.md).
The local Gemma key is missing; no new real inference has run in this work.
The page says **Model connection pending** and lets the owner save briefs;
generation remains unavailable. Do not claim a delivered live AI team yet.
The bounded test inference use is authorized, but SmartLabs/SmartCC/Gemma service
changes and provider actions remain excluded. Production score remains60/100.

**As of 2026-09-06: public test VPS is live; certified 38.247 unchanged by this work.**
Tamer reformatted CPU VPS 155.117.45.45 and authorized a public HTTPS test
installation under #200. He subsequently accepted pinning its replacement SSH
key without a provider console; this is not independent identity verification.
The rebuilt host now runs four scoped test services; old incident records are
historical. The new package uses an isolated local business database and existing
Supabase owner sign-in, not production data or the Supabase admin key.
Initial public deployment passed at `380eb19`; the #205 logout update at
`6c8c536` is the retained rollback image, superseded by the workspace deployment
above. See the [initial dated evidence](evidence/2026-09-06-fresh-test-vps-deployment.md)
and [owner walkthrough](testing/FRESH_TEST_VPS_GUIDE.md).
Test link: https://tanaghom-test.155-117-45-45.sslip.io/login.
The initial deployment performed no model/provider execution or n8n activation.
The latest authorization above permits a bounded workspace successor on this
test host only, not changes to certified 38.247/SmartLabs/SmartCC services.
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

The workspace source is PR #208 at `208f6ce6e20f4b8d4fbfd042495765efdd6b3352`
(41/41 exact-head CI checks passed), followed by the narrowly scoped deployment
corrections #209/#210. Exact running source is recorded above. The accepted model-runner slice
remains PR #198 at `9fde3aa673f4bc634c36bab00957cbf7f84ebd91`.
The original pre-expansion baseline was `0b5b5a7` (PR #173). Neither source merge
nor local adapter simulation establishes what is currently deployed.

## Evidence layers

| Layer | Verified fact or limit | Source |
|---|---|---|
| Source baseline | 35 up/down migration pairs through0035; business/shared runtime exports plus separate Agency pilot and workspace dispatchers | Exact workspace source above |
| Foundation issue state | #132, #133, #134 and #135 are closed implementation slices | [Pre-expansion issue snapshot](evidence/2026-09-06-pre-expansion-github-issues.json) |
| Historical Studio certification | 14/14 canonical English/Arabic simulation scenarios recorded; agent stayed validated, zero provider actions | [2026-07-27 #137 evidence](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/137#issuecomment-5095194632) |
| Last reviewed deployment record | PR #173 deployed at 0b5b5a7; migration 0033; dashboard health/boundaries passed then | [2026-07-28 #125 evidence](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/125#issuecomment-5104583814) |
| Current certified server/provider health | Not checked by this planning task; July records are historical | Fresh authorized preflight required |
| Selected CPU test host | Public dashboard, PostgreSQL, Caddy and private n8n on155.117.45.45;0035, 90GB free; workspace dispatcher inactive, all model/provider execution stopped | [Workspace deployment](evidence/2026-09-06-agency-workspace.md); [workspace walkthrough](testing/AGENCY_WORKSPACE_GUIDE.md). Earlier inventory is historical |
| New expansion | Six original candidates and simulation adapters retained; separate document workspace successor deployed with five model procedures plus deterministic summary; no real-model quality certification | [Workspace scope](planning/agency-expansion/WORKSPACE_DELIVERY.md), [runtime package](../packages/agent-runtime/README.md) |
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

The #200 test deployment and #205 HTTPS logout follow-up are verified. Next
perform the [owner's manual walkthrough](testing/FRESH_TEST_VPS_GUIDE.md)
and prepare a separately reviewed CPU n8n/evaluation + shared-Gemma transport
package under #177. All model/provider actions remain disabled. This supplies
a test UI, not full automated agent UAT; invitations are unavailable without
a separately scoped auth admin key. Actual owner password sign-in is not claimed.

#192's source fix, planning PR #191, candidate PR #194, kernel PR #195 and
authenticated integration PR #196, preparation PR #197 and simulator PR #198
are accepted. #198 passed all 40 exact-head CI checks. Tamer delegated Tanaghom
technical PR reviews to Codex; code review does not replace business acceptance.
Next prepare/review the private evaluation resource/network package and successor
shared-Gemma transport alongside the running test UI. Use approved model records, obtain missing compiler/model
metadata and the operator request window, and collect the business-reviewer
nomination in parallel. The old co-hosted VPS inventory was superseded by Tamer's
reformat. The fresh test deployment's health does not certify shared Gemma or
the existing 38.247 production environment.
See the linked setup proposal for review examples, bounds and remaining decisions.
The prerequisite checker cannot grant authority. No live model/provider call
is authorized by the completed UI deployment. Keep every candidate
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
