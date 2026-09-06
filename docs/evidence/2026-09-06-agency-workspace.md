# Agency workspace delivery evidence

Authorized scope: #176, #177, #178, #179; isolated test VPS155.117.45.45 only.

## Implemented source

- Single-specialist and ordered six-step assignments using the existing Agency
  queue, immutable brief/facts, saved task handoffs and result/version lineage.
- Five Gemma document specialists and one deterministic delivery summary.
- Customer-visible `/workspace`, mobile navigation, result export, shared-context
  inspection, durable human acceptance/rejection, pause and cancellation.
- Migration0035, restricted worker RPCs, fixed private gateway and an inactive,
  immutable-image-pinned n8n dispatcher. No provider actions or auto-approval.

## Disposable validation

- Repository tests:175/175 passed; repository verification passed. Workspace
  source PR #208 and first deployment correction #209 each passed41/41 CI jobs.
- Dashboard production build and TypeScript pass.
- All35 migrations apply; unused0035 down/up passes. Used0035 rollback refuses.
- Fifteen database check groups pass, including English/Arabic six-step chains,
  duplicate create/start/completion, old-simulator exclusion, exact-hash review,
  pause/resume/cancel and worker approval/table-write denial.
- Real authenticated browser: owner sign-in, create/save/start, six handoffs,
  shared context, approval, mobile width and Arabic RTL. Cross-origin cookie
  mutation, missing membership, cross-tenant read and viewer mutation rejected.
- Real restricted-worker HTTP endpoint completes a deterministic-only assignment
  without contacting Gemma.
- Pinned n8n2.26.8 imports the actual export inactive, encrypts the fixture
  header credential and executes its actual HTTP node: exactly one authenticated
  request to an isolated authored gateway, no retry or external inference.
- Independent visual/mechanical UI review completed. Fixed button styling,
  mobile assignment shrink, stale queued notice, keyboard tabs and panel clipping.
  Local screenshots in `tmp/workspace-qa/`; CI uploads the disposable screenshots.

**These are authored test fixtures, not real Gemma quality results.** The browser
fixture labels its documents explicitly. No fixture is seeded into the public
test environment. No real model call or provider action was made for this evidence.

## Deployment observed 2026-09-06, approximately 19:07 UTC

The controlled update committed successfully on the isolated test VPS only.

| Check | Observed result |
| --- | --- |
| Public entry | https://tanaghom-test.155-117-45-45.sslip.io/workspace |
| Exact deployed source | `369525f8fdf4dcd494ad09c50bde727237e23d89` (PR #210; workspace source in #208, deployment fixes #209/#210) |
| Dashboard image ID (container inspect) | `sha256:5bd46c1ac0fde8167c0a1ce3518fe55e4a80fbe1b58556a711d1376fc2e23a8c` |
| Local business DB | `0035_agency_workspace`; zero assignments and zero Agency tasks |
| Services | Dashboard, PostgreSQL and private n8n healthy; Caddy running, public HTTPS health passed; all four restart counts0 |
| Workspace execution control | `enabled=false`, `emergency_stop=true`; shared runtime emergency stop also true |
| n8n | Actual three-node workspace export inactive, zero executions, one encrypted gateway credential |
| Private gateway | Missing token rejected401; correct token plus invalid action rejected400 without claiming work |
| Public boundary | Workspace API401 without session; internal gateway404 through Caddy |
| n8n Internet isolation | Direct TCP connection to38.247:443 unavailable; no inference request issued |
| Root disk | 90GB free of103GB, 10% used |
| Public browser | Fresh desktop1440px and mobile390px login: HTTP200, no horizontal overflow or page exceptions |

Public checks did **not** use the real owner's password. Authenticated end-to-end
workspace coverage above used a disposable auth/database fixture; public owner
sign-in and live model acceptance are still unverified. No fixture was loaded
into the public database.

### Deployment defects and rollback evidence

The first update applied0035, then the API-role probe incorrectly tried to read
the admin-only migration ledger. Automatic rollback restored the old dashboard;
0035 and its evidence were preserved. PR #209 removed that redundant query
without broadening database privileges and added a guarded unused/stopped resume.

The second attempt passed database checks and imported n8n inactive, but n8n
startup needed `/home/node/.cache` on its read-only filesystem. Automatic rollback
again restored the previous dashboard and stopped only the new private n8n.
PR #210 adds a bounded128MB UID1000 cache tmpfs and a real read-only server-startup
test. That test passed before retry. The final resume verified the original
backup checksum and inactive zero-execution import; it did not replace the
original backup, secrets or rollback image. No assignment or inference ran
during any attempt.

Root-only rollback evidence remains at
`/opt/tanaghom-test/runtime/workspace-20260906T185616Z`, referenced by
`/opt/tanaghom-test/runtime/workspace-update-state`. The encrypted0034 backup was
checksum/list validated, not restored into an independent recovery environment.
This local safeguard is not off-server disaster recovery. Follow the exact
[rollback runbook](../../deployment/agency-workspace/RUNBOOK.md); never delete
workspace history to force a database downgrade.

### n8n audit findings, not a zero-findings claim

`n8n audit` completed. It reported the intentionally unused/not-recently-used
gateway credential and classified the HTTP Request node as risky. Its URL is
fixed to the private dashboard gateway; the n8n container has no public port or
Internet route, no Gemma/database key and no user-controlled tool endpoint.
Execute Command, Read/Write Files and SSH nodes are excluded. The audit also
listed the configured disabled public API/community packages/telemetry settings.
These findings are recorded and constrained for this stopped test installation;
they are not evidence of a production security certification.

## Remaining live-inference gate

The local `.env` has no `GEMMA_API_KEY`; the mounted test secret is empty. The
known model health endpoint returned200 and unauthenticated inventory401. No
real model call was made. The deployed page truthfully reports **Model connection
pending**: owners may save briefs, but cannot start generation yet.

Next: securely configure the key, verify the exact served model/context limit,
run bounded English/Arabic real-model canaries and a full work pack, then publish
only the private dispatcher. Keep every provider execution path disabled.
Formal #177 comparative quality certification and customer business approval
remain separate. No SmartLabs/SmartCC/voice/Gemma service was changed.

Existing production release evidence score remains60/100. This test deployment
does not manufacture additional certified-host/live-provider acceptance points.
