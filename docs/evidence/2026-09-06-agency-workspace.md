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

- Dashboard production build and TypeScript pass.
- All35 migrations apply; unused0035 down/up passes. Used0035 rollback refuses.
- Thirteen database check groups pass, including English/Arabic six-step chains,
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

## Deployment and real inference

Pending at this source checkpoint. Read the later dated deployment section or
issue comment before claiming this source is running. The local `.env` has no
Gemma credential; the known health endpoint returned200, and unauthenticated
model inventory returned401. Real model acceptance and customer approval are
not passed. No SmartLabs/SmartCC/voice/Gemma service was changed.

Next: deploy this reviewed workspace package to the isolated test VPS; securely
configure the Gemma key; run bounded English/Arabic real-model canaries and a
full work pack, then publish only its private dispatcher. Keep all provider
execution disabled. Existing production release evidence score remains60/100;
this expansion does not manufacture additional live-provider acceptance points.
