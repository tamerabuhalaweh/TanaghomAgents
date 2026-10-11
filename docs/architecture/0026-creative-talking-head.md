# ADR 0026 — Provider-neutral avatar, talking-head and lip-sync foundation

Status: ACCEPTED ARCHITECTURE / SOURCE IMPLEMENTATION IN PROGRESS
Issue: #240 under master #221; provider research #239.
Baseline: 04eb35a4bf14ff98efd0023a182f0e1c9f578d60.
Human authorization: 2026-10-11, source only; real provider use, spend, enrollment and deployment forbidden.

## Decision
Architecture B: Tanaghom owns canonical avatar identity, consent, tenancy and governance. One avatar may have multiple provider bindings; no remote avatar identifier is a canonical ID. TalkingHeadAdapter and LipSyncAdapter are separate capabilities. HeyGen conditional primary, Sync lipsync-2 specialist, Tavus fallback binding extensibility only. Synthesia remains documentary alternative, no adapter.

Initial talking-head lane is approved stock presenter + bounded script -> MP4 draft. Independent lip-sync lane uses approved tenant-controlled visual and existing audio asset versions, not arbitrary URLs or provider text/TTS. Future Voice remains separate. Provider-managed speech intrinsic to stock script rendering is not a Tanaghom permanent TTS or voice-cloning system.

## Runtime and worker lane
Reuse PostgreSQL creative_jobs queue and P4 controlled provider-call begin/full-reader/request-anchor/reconcile functions. Reuse existing gpu_video lane if clean operation/capability filtering is verified during implementation; no parallel queue. Dedicated claims must restrict exact talking_head and lip_sync operation+capability; P4 generative-video, motion, segment and image decoys remain untouched. Record final implemented lane and reasoning in task evidence.

## Authorization
Both API submission and worker execution verify tenant identity, avatar active, binding active and provider/model allowlist. Real-person generation additionally requires verified applicable scoped consent, nonexpired and nonrevoked, and CUSTOM_AVATAR_ENABLED. Recheck before create; revocation after queue must mean zero create requests. Revocation never deletes historical assets/provenance. Provider deletion bookkeeping is independent.

Workers retain EXECUTE-only SQL functions with SECURITY DEFINER safe search_path; no table grants. Existing Supabase JWT/RBAC, request idempotency and audit correlation remain canonical.

## Provider lifecycle and media boundary
Immediately attach returned remote ID. Same task must be queried on retry/recovery; create indeterminate without ID is fail-closed, never blind retry. Settle remote success and genuine actual cost (unknown remains null) before local artifact processing. Local failure cannot rewrite remote success. Local cancellation is intent, not provider cancellation. No cancel endpoint without documented support.

Reuse hardened downloader and MP4 validation; extend audio-track metadata only. Input controlled asset readers validate tenant approval, byte MIME/magic/container/codec/dimensions/duration/checksum. Private output versions remain drafts with immutable lineage and human approve/reject; no publishing.

## Gates
TALKING_HEAD_ENABLED, LIP_SYNC_ENABLED, CUSTOM_AVATAR_ENABLED default false. This PR targets Source Complete only; Provider Accepted, Custom Avatar Accepted and Production Certified remain separate and unpassed. Stub evaluation status is LEDGER ONLY / EXTERNAL ACCEPTANCE PENDING; Arabic quality requires future human evaluation.

HeyGen privacy/legal/training/biometric/cost/quality acceptance remains blocking for real use. Synthesia additionally requires written public-DPA/privacy biometric clarification and subject self-enrollment; permission held by Tanaghom/agent is not self-enrollment. Tavus custom creation voice-cloning implications remain outside scope.

## Migration
0046_creative_talking_head follows exact 0045 baseline if current main unchanged. Historical 0041/0042/0043 reservations are retained, not backfilled. Rollback removes executable P5 functions and disables every presenter control, but capability/provider-operation vocabularies remain append-only. Unused governance tables can be removed; used avatar/binding/consent records and immutable guards remain as history. Re-up restores execution functions against retained tables without changing history and resets all controls OFF. Disposable acceptance compares exact governance/job/asset/version/provider-call rows across used-state down/up as well as exercising an unused-schema down/up.

## Non-goals
No real provider requests/media uploads/spend; no custom enrollment, permanent TTS, voice cloning, music, realtime/WebRTC/conversation/phone avatars, publishing, billing/credits, deployment, SmartLabs/SmartCC or other voice infrastructure.
