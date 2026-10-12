# #242 correction1 — current-byte local evidence, awaiting BOTH independent re-reviews

Base/HEAD remains `b81e01e5c9d3b5486632569014008aabf11a01f1`. No commit, push, PR, merge, deployment, live provider calls or #243 work. The original 80 evidence files in `../smartlabs-242-local/`, old freeze and both independent BLOCKED reports remain untouched. This evidence is worker verification, NOT reviewer approval. The authoritative complete indexed freeze/manifest lives outside the candidate at `smartlabs-242-correction1-final-freeze.json` beside the worktree; do not embed a self-referential patch hash here. The earlier correction freeze captured only nonignored evidence entries; it is retained as a superseded incomplete staging attempt, not the review candidate. All correction evidence is explicitly staged despite repository log/JSON ignore rules in the final freeze.

## Exactly four corrected findings

* A: `smartlabs-runtime.ts` controlled reader requires tenant-matching SQL `v.status = 'approved'` before private bytes are read/uploaded/audited. Generated TTS remains draft. Smoke persists a `REVIEW_REQUIRED` same-source receipt after G1/T1; a human must approve through the existing decision API before an authorized separate A1 invocation. No autoapproval, new route or job-state system; no G1/T1 re-spend.
* B: request-scoped TTS/ASR read existing authoritative Creative enabled/not-emergency-stopped control using existing API SELECT rights. Missing/read-failed control is sanitized/fail-closed. The check precedes TTS durable reservation and ASR private I/O; old claims do not bypass it. This read is NOT atomic exclusion against a subsequent stop commit.
* C: provider-neutral validation remains compatible with legacy transports; SmartLabs admission stays held through paid-result JSON/WAV/semantic validation. Unaccepted paid 200 results are indeterminate and quarantine the process/backend across fresh factories. Valid success releases; pre-contact refusal, definitive HTTP auth/validation refusal and Retry-After semantics are retained. No automatic retry, durable/distributed quarantine, or external exactly-once claim. Same-job durable TTS protection remains.
* D: identical pre-change 0047 up/down restricted-baseline checks cover all 15 existing Creative/brand-kit tables, seven worker table privilege classes, six forbidden API table classes, relevant column privileges, unsafe role attributes/memberships/schema CREATE, and the controlled version-function execute matrix. No broad grant or silent repair. API SELECT is preserved.

## Verified native gates

`source-receipts.json` records six exact commands, exits and log digests. `verified-source-bytes.json` records the 34 implementation/test/config/docs files actually verified; `build-isolation.json` records decoder/lock/restored generated-file digests and the scan.

* Targeted tests: **102/102**, zero fail/skip, exit0, installed versioned decoder unchanged.
* Full `npm test`: **445/445**, zero fail/skip, exit0.
* `npm run check`, `npm run typecheck:dashboard`, normal `npm run build:dashboard`: exit0.
* Online `npm audit --json --audit-level=moderate`: exit0, zero reported vulnerabilities. No install/update/version or lock change.
* Fresh production output scan: **2073** emitted/public files, zero fake-key/path leaks and zero `SMARTLABS_` name hits. Actual built Next rendered `/login`, `/workspace`, `/creative`, `/api/health` also checked with no marker/name leaks; production server logs and safe response/audit projections checked in the combined run.
* Post-native/browser final output rescan: **2169** emitted/public files, zero fake-key/path leaks and zero `SMARTLABS_` name hits (`post-native-artifact-scan.json`). Additional Next-generated artifacts are included rather than silently excluded.
* Adapted independent regression harness: **7/7**, exit0. Original reviewer probe is untouched. Only its SQL-shape assertion/status-filter double was adapted to the now-approved-only predicate; all expected denial/quarantine outcomes are unchanged. Copy: `runtime-probes.mjs.txt`; native log: `runtime-probes.log`. These are auth/DB/storage doubles, not the native DB certificate.

`native-receipts.json` records **32** command receipts (including startup readiness, exact-ID ownership/cleanup and intentional refusal/absence exits), not 32 independent assertions. `native-raw-receipts.json` preserves the original runner records. Full raw command output is in `native-*.log`.

* Cached pinned PostgreSQL **17.6**, owned uniquely labelled fresh clusters and ephemeral loopback ports only; complete historical chain, **44** actual migrations through0047.
* The two original DB mutations first reproduced RED (both unsafe acceptances at0046) and now fail with the required guard (psql exit3), before any new-format data is created.
* Native matrix: **318** rollback-only unsafe cases for up and **318** for down across **15** tables; role/column/table/destructive/membership/schema/function variants. Required guard message, ledger/function/table/role/member snapshot restoration and intended API SELECT asserted. Unused and populated old-format down/up, repeated/wrong-baseline refusals, used immutable new-format refusal with full row JSON preservation all pass.
* Actual audio SQL assertions: exit0; restricted controlled worker draft registration, private tenant key scope and unchanged controls.
* Combined fresh compiled actual factory/JWT/JWKS/auth + restricted API/worker PG logins + private filesystem + actual built Next enqueue/decision/routes: exit0. Existing claimed/running TTS job blocked with disabled or emergency-stopped DB control: zero reservations/reads/provider creates. Historical approved ASR source likewise blocked before I/O. Draft and foreign ASR refused, human approval performed by existing Next decision API, then same approved source transcribed with lineage/checksum/hash-only audit.
* Combined provider-shaped stub counts: Gemma1/TTS1/ASR1/models0; real provider calls0. Native WAV4844 bytes; SHA256 `8c8a8b3f48179dc4fc9abb5e6afad9df40f28d48e53c9269bfde32eb500f4a4a`; job succeeded, source approved at ASR.
* Separate fresh-cluster registered foundation integration: exit0, authenticated private upload/decision/preview, tenant/role isolation and EN/AR desktop/mobile browser journeys. All SmartLabs flags OFF.
* Both exact final fixture IDs checked with their owner labels before removal; absence and owner-label census verified afterward. No foreign resources removed.

## Retained REDs and setup corrections

A/B/C/D historical native RED and corresponding GREEN logs are preserved here and outside. Smoke review-pause RED is preserved. `targeted-attempt1.log` records a test-fixture mistake (the WAV helper ignores an attempted second argument); the invalid-audio fixture now explicitly zeros PCM bytes. `targeted-attempt2-old-cli-fixture.log` records the old CLI stub receipt shape; it was updated to the real review-pause contract without relaxing any secret check. These are superseded by current final green logs, not erased or counted as product passes.

## Holds

Both independent re-reviews at the new exact freeze are still required before parent publication/CI and senior merge/STOP. Live G1/T1/A1, credits, latency, Arabic quality, production tokenizer/template/thinking attestation, private deployment ACLs, decoder OS containment and distributed admission remain NOT RUN/UNKNOWN/operator-gated. Flags default OFF; no canary/SmartCC/P5/paid media/provider/SSH/model installation, production activation or #243 continuation.
