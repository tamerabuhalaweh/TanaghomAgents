# Tanaghom status and next work

**As of 2026-09-06: repository/GitHub review, not a fresh production audit.**
Current task authorization: targeted #192 dependency remediation, acceptance of
the planning PR after its gates pass, and the six-profile pilot source work.
No production deployment, live model/provider call or activation is authorized.
Start here: [developer context](PROJECT_CONTEXT.md).

## Executive state

Tanaghom has implemented campaign/content, approvals, customer integrations,
conversation governance, skills, Agent Studio and the shared policy runtime.
Its initial commercial pilot remains separate from full live-provider
acceptance. The new all-department expansion is planned, not implemented.

The source baseline inspected is
`0b5b5a761099e6eb6163efbeb00a75d891d680c7` (PR #173), matching remote main
when this work began. New planning documents change no runtime behavior.

## Evidence layers

| Layer | Verified fact or limit | Source |
|---|---|---|
| Source baseline | 33 up/down migration pairs through 0033; eight business + six shared runtime workflow exports | Repository at the baseline SHA |
| Foundation issue state | #132, #133, #134 and #135 are closed implementation slices | [Pre-expansion issue snapshot](evidence/2026-09-06-pre-expansion-github-issues.json) |
| Historical Studio certification | 14/14 canonical English/Arabic simulation scenarios recorded; agent stayed validated, zero provider actions | [2026-07-27 #137 evidence](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/137#issuecomment-5095194632) |
| Last reviewed deployment record | PR #173 deployed at 0b5b5a7; migration 0033; dashboard health/boundaries passed then | [2026-07-28 #125 evidence](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/125#issuecomment-5104583814) |
| Current server/provider health | Not checked by this planning task; July records are historical | Fresh authorized preflight required |
| New expansion | Epic #174, issues #175-#190, 273 source profiles catalogued; no adaptations or activations | [Expansion plan](planning/agency-expansion/README.md) |

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
- **#175**: full catalog review/admission; initial metadata inventory is present.
- **#176**: six-profile pilot (strategy, content, brand review, discovery,
  customer care, executive reporting).
- **#177**: paired bilingual evaluation and resource/safety evidence.
- **#178**: bounded team assignments on existing runtime handoffs.
- **#179**: team onboarding/operations UX.
- **#180**: governed improvement proposals.
- **#181-#190**: complete department coverage, including restricted-domain gates.

Existing #150 Hermes, #151 older flow-pack intake, #152-#155 commercial skill
tracks, #136/#156 MCP, and #157 video retain their ownership. No duplicate
Hermes or analytics executor is being introduced.

## Next best move and authority

Accept #192 and documentation PR #191 only after their full CI gates pass.
Tamer has authorized the next scoped source work on
**#175's six selected semantic reviews and #176's pilot contracts**, with
#177's rubric/data plan established before comparison results. Do not wait
for all future departments. Full source review under #175 remains a longer
parallel roadmap task, not a pilot launch blocker.

Keep #125/#45/#54/#56/#137 provider acceptance on its separate critical path;
new templates are not a substitute for those tests.

No developer may infer authority to modify SmartLabs, SmartCC, voice, Gemma
services, credentials, firewall, Nginx, n8n activation or customer/provider
state from the expansion approval.

## Status maintenance

Update this file with each material change. Name the source commit, evidence
date and exact completion gate. A live issue is current work coordination;
its versioned snapshot and PR evidence are the recoverable history. Do not
reuse an old percentage as a new production-readiness measurement.
