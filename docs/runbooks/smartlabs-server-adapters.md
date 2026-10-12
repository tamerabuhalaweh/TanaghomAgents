# SmartLabs server adapter runbook — issue #242 / roadmap #221

## Current posture

SOURCE/OFFLINE ONLY. All new flags default OFF. No live SmartLabs request, provider health call, GPU generation, voice cloning, model/weight installation, presenter/lip-sync testing or production activation is authorized for this worker. Existing structured/certified flows are untouched. Independent parent review and CI precede publication; senior owns merge/STOP.

## Public defaults and secret handling

`.env.example` contains only these public defaults and blank secret values:

```dotenv
SMARTLABS_GEMMA_ENABLED=false
SMARTLABS_TTS_ENABLED=false
SMARTLABS_ASR_ENABLED=false
SMARTLABS_GEMMA_BASE_URL=https://api.thesmartlabs.net/gemma4/v1
SMARTLABS_GEMMA_API_KEY=""
SMARTLABS_GEMMA_MODEL=gemma4-26b-a4b-canary
SMARTLABS_API_BASE_URL=https://api.thesmartlabs.net/v1
SMARTLABS_API_KEY=""
SMARTLABS_TTS_BACKEND=omnivoice
SMARTLABS_TTS_VOICE_ID=smarttts2-xms-default
SMARTLABS_ASR_URL=https://api.thesmartlabs.net/v1/transcriptions
SMARTLABS_ASR_LANGUAGE=ar
```

An authorized operator imports the already-held SmartLabs credentials directly into the Tanaghom BACKEND secret store/session. Do not ask for keys in chat, read/copy/print server secret files with the agent, commit keys, place them in NEXT_PUBLIC_* variables, use them in command arguments, snapshot them, or modify the SmartLabs/SmartCC/telephony servers. This worker did not inspect secret values or install credentials. Missing/malformed credentials fail closed; a fake invalid-key fixture exercises sanitized 401 behavior, not live key validation.

### Backend file credentials (#242 application support)

The application config and explicit smoke CLI accept `SMARTLABS_GEMMA_API_KEY_FILE` and `SMARTLABS_API_KEY_FILE` as alternatives to the respective direct key variables. These names are backend-only. The operator supplies an absolute local file path; no path or credential belongs in tracked examples. **Unset** the direct variable (even an empty direct assignment conflicts with `_FILE`). Both sources present is rejected deterministically, never precedence-selected.

Files must be readable regular files of 1–4096 bytes. Exactly one final LF or CRLF is accepted as a file-writing convention and removed; nothing else is trimmed or normalized. Empty keys, leading/trailing/interior whitespace, extra newlines, NUL/non-ASCII bytes, missing/nonregular/unreadable files and oversized files fail closed with a constant error, without path/key/cause disclosure. Direct keys must be nonempty printable ASCII without whitespace when their capability is enabled. Missing keys with all flags OFF remain unconfigured and non-spending. Credentials live in server memory only. Deployment/secret installation and host ACL verification remain operator gates; this does not resume #243.

## Trusted server factory

```ts
import {smartLabsRuntime} from '@/lib/server/smartlabs-runtime';
// request comes from the existing authenticated server boundary, never an actor ID.
const runtime = await smartLabsRuntime(request, {
  tokenCounter: pinnedExactMessageCounter,
  thinkingDisabled: verifiedOperatorThinkingAttestation,
  inspectCompressed: approvedPinnedDecoder, // absent => compressed ASR fails closed
  workerPool: existingControlledCreativeWorkerPool,
  // Optional: pure mapper with externally verified SmartLabs billing header names.
  // readBilling: verifiedNumericBillingMapper,
});
const draft = await runtime.tts.synthesizeToAsset({jobId: ownedClaimedVoiceJobId, text: 'مرحبا بكم في تناغم.'});
// STOP for human review through the existing asset decision API. No autoapproval.
// Only after that SAME private version is currently approved:
const transcript = await runtime.asr.transcribe({sourceVersionId: draft.assetVersionId});
```

The existing owner/operator authorization, Creative Studio guard and cookie same-origin protections apply. There is no new public endpoint. Capabilities, pools, token counters and media inspectors are trusted installed server code, not browser/job JSON. Do not cache the request-scoped factory across users. The caller must use an existing voice job, not manufacture an actor/queue/identity. The factory requires a live claim and at least 180 seconds of remaining lease before paid TTS; smoke preflights tenant ownership and enough lease before G1 as well. It uses existing worker functions and private storage; outputs remain draft and require normal human review.

Each TTS/ASR invocation reads the existing authoritative `creative_controls` row using the existing API SELECT grant. Disabled, emergency-stopped, missing or unreadable control fails closed before TTS attempt reservation or ASR private I/O. A historical running job is no exemption. This current read boundary does NOT atomically exclude a stop committed after the read or dispatch. ASR SQL requires the tenant's version to be currently `approved`; draft, rejected, archived, revoked and foreign versions cannot trigger private read/upload or transcript audit.

Keep private asset storage outside any web/public directory; maintain service-account-only filesystem ACLs/bucket access and the existing authenticated asset-serving boundary. Do not grant broad rights or expose an object-key URL. On Windows verify inherited private-directory ACLs; container checks do not certify host ACLs. No reference audio, arbitrary voice/backend ID, cloning input or external media URL is accepted.

## Operator blockers BEFORE enabling or real smoke

1. Source review, full regression, native dashboard typecheck/build, current moderate-or-higher dependency audit and real client-bundle secret isolation must be green. Read the handoff: missing dependencies or offline audit coverage are not green provider/deployment gates.
2. The correct backend secrets must be safely installed by the operator; all three new flags must be explicitly true only in the approved isolated canary session. Do not alter existing provider selectors, governor controls or telephony/voice infrastructure as a workaround.
3. Supply a pinned exact tokenizer and exact Gemma chat template/model-context binding. No character/byte heuristic or invented tokenize endpoint is allowed. No counter is installed by this source change.
4. Verify thinking is OFF at the deployed backend and pass the trusted attestation. No undocumented wire parameter is sent and the boolean is not remote proof.
5. Confirm a single admission-owning process or a separately reviewed distributed arrangement. A process-global map is not a cluster-wide limit. After timeout/crash/5xx uncertainty keep flags OFF until the provider work is proven settled; never reboot or retry to evade the circuit.
6. Approve the executable digest/OS containment for compressed input if needed. WAV native PCM16 supports exact sample bounds; MP3/Ogg Vorbis or Opus/FLAC/AAC ADTS use full bounded decode, not a caller MIME/duration or ffprobe duration alone. WebM and MP4 are rejected. Input is at most 25 MiB / 20 decoded seconds. The existing decoder's forced demuxing, codec/protocol allowlists and resource limits are not a general-purpose OS sandbox certificate.
7. If billing metadata is required, provide only the verified numeric header mapper; do not guess provider names or copy raw headers. Without it credits/balance are unavailable, not assumed free.
8. Prepare an existing tenant-owned synthetic voice Creative job and controlled worker capability through the reviewed existing runtime. Do not build a second queue/job/identity or enable the stopped CosyVoice backend. The private store and migration must be deployed through the normal approved application process, not by this worker.

## Explicit future G1/T1/A1 command — NOT RUN here

Only POST-MERGE, after the above gates, Astra safely installs the backend keys and a separate parent/operator authorization, the installed backend may provide a private trusted context module exporting `createSmokeContext()`. It obtains the existing authenticated owner request (not a supplied actor), constructs this source factory with approved capabilities, and returns `{runtime, jobId, sourceGatesPassed:true, providerAuthorization:'ISSUE242_G1_T1_A1'}`. The true value is an operator attestation, not a substitute for CI evidence. This repository intentionally does not invent a login/session bootstrap, expose a smoke HTTP route or embed credentials.

```sh
node scripts/smartlabs-smoke.mjs \
  --confirm=ISSUE242_ONE_ATTEMPT \
  --trusted-context=/absolute/private/backend/issue242-context.mjs
```

On Windows use an absolute local drive path. URL/UNC context paths and unknown options are denied. Missing explicit confirmation, flags, key presence or reviewed context blocks before invocation. Never add this command to CI, startup, scheduled jobs, health, automatic canaries or retries.

The actual server smoke authenticates owner, verifies the existing owned voice job and current execution control before spending, reserves a database-global issue-242 one-attempt group in the EXISTING idempotency table under a PostgreSQL transaction advisory lock, then executes:

* G1: one short generic Arabic Gemma request (plain messages, max_tokens=64).
* T1: one short generic Arabic OmniVoice generation, stored as private draft audio.
* STOP: persists a `REVIEW_REQUIRED` receipt referencing the same private T1 draft; A1 is `NOT_RUN_REQUIRES_APPROVED_SOURCE`. It does not autoapprove or transcribe the draft.
* A1: after explicit human approval via the existing Next decision API, the authorized installed backend calls `runtime.asr.transcribe({sourceVersionId: receipt.T1.assetVersionId})` exactly once for that same source and captures sanitized hash/metadata evidence. Do not rerun the smoke or G1/T1. This uses the existing ASR method, not a new endpoint, job state or implicit caller-trust bypass. The group receipt is complete as a review pause, not a claim of complete G1/T1/A1 acceptance.

No customer/human voice, reference clip or lip-sync provider is involved. There are no automatic retries, including timeout/credit/validation/auth failures. Metadata receipts contain statuses, IDs, latency, usage, byte/duration/sample metadata, hashes and Arabic checks; no credentials, prompts, transcript text, raw headers or audio bytes are printed. Billing stays unknown unless verified mapping is supplied. A review-pause receipt is not A1 acceptance, quality certification or production activation. Review checks and actual Arabic quality/credits explicitly; then restore all flags OFF.

## Recovery — no blind re-spend

The group and per-job TTS reservations commit BEFORE external work. Processing, failed/interrupted or completed group entries all prevent a rerun, including a different owner. Do not delete/purge idempotency entries or owner records to retry. A processing receipt may contain no final metadata after interruption; investigate provider-side settlement through the approved operator channel without another generation/upload. Existing per-job metadata and private draft versions can be inspected by their authorized tenant/worker paths. No provider paid-create deduplication is promised.

If database COMMIT is ambiguous after private output was written, retain the artifact and use the existing controlled job/version records to reconcile. Do not delete potentially committed audio or rerun TTS. If a result/guard needs manual repair, obtain independent approval and preserve metadata evidence first. There is no automatic reset/unlock/recovery endpoint.

Malformed JSON, invalid WAV or invalid Gemma/ASR semantics after a paid HTTP 200 are conservatively indeterminate. Admission remains held through result validation and quarantines that backend across fresh adapter factories in the same process; a second explicit request is refused, not retried. Validated success releases the slot; pre-dispatch input refusal and definitive HTTP auth/validation refusal do not quarantine it; Retry-After cooldown still applies. This is not proof of lingering provider execution, durable quarantine after process death, distributed exactly-once, or removal of the existing same-job TTS guard.

## Offline verification and evidence

Native Node tests: `tests/smartlabs-adapters.test.mjs` and `tests/smartlabs-server-factory.test.mjs`. These use real owned local sockets, compiled actual server factory with auth/database boundary doubles, actual private file I/O and dummy credentials only. A native pinned installed ffmpeg executable exercises full MP3/Ogg Vorbis/FLAC/AAC decode and decoded-output overflow; this is not real provider quality or billing.

The database fixture is `packages/database/tests/smartlabs_audio.sql`; apply migrations through 0047 only to a fresh owned disposable database, execute the fixture with ON_ERROR_STOP, and destroy only that verified owned fixture. It rolls back rows and proves the actual controlled worker function, key/MIME support, tenant-scoped reads and direct-write denial. Migration down refuses existing new-format versions instead of deleting immutable data. Do not point tests at a shared/live database or read real .env credentials.

`npm ci` in this isolated source worktree was separately approved and completed against the existing pinned lock; no version/lock/global changes are authorized. Normal source gates are `npm test`, `npm run check`, `npm run typecheck:dashboard`, `npm run build:dashboard`, and online `npm audit --audit-level=moderate` (the CI threshold). Do not alter the preserved P5 worktree. Offline audit alone is not current advisory clearance. Correction native receipts and actual compiled-browser/HTML fake-marker isolation are in `docs/evidence/smartlabs-242-correction1/`; `smartlabs-242-local/` and the old scratch handoffs/independent BLOCKED reports are preserved historical evidence, not the current-byte certificate.

### Local native database/application acceptance

`scripts/smartlabs-migration-verification.mjs` takes `DATABASE_TEST_URL` for an owned loopback database named `smartlabs242` and `SMARTLABS_LOCAL_FIXTURE_OWNER` matching the verified `issue242-<UUID hex>` resource label (an owned foundation label is also accepted). Set the database COMMENT to the exact owner label through the verified fixture's admin connection; the script refuses a mismatched durable ownership marker. Start it from the complete historical chain through 0046. It verifies actual restricted role/permission refusal, 0047 full ledger, unused and populated old-format down/up preservation, repeated/wrong-baseline refusal, and used new-format down refusal. No broad role grants are installed by 0047. The historical chain has reserved numbering gaps; compute its actual ledger count, do not assume 47 entries.

`scripts/smartlabs-local-integration.mjs` requires that same explicit owned database marker through 0047, an already-built normal dashboard, and the approved existing local dependencies. It temporarily gives the two existing least-privilege roles LOGIN only with a **synthetic fixture-only** password inside the owned database cluster, not new grants. It uses actual restricted API/worker logins and controlled enqueue/claim/complete/approve functions, actual JWT/JWKS authorization and real private filesystem bytes. The factory seam is fresh TS compilation mounted by a loopback-only test harness, not a new application public route; existing Next job/approval/rendered routes run from the actual production build. Gemma/TTS/ASR are owned HTTP stubs. The exact counter is bound only to the immutable synthetic fixture, not an operator production tokenizer/template certificate.

Run the registered `scripts/creative-foundation-integration.mjs` against its **own fresh PostgreSQL cluster**, not merely another database in a used cluster: some historical migrations correctly refuse pre-existing package roles. Optional `CREATIVE_TEST_AUTH_PORT` / `CREATIVE_TEST_DASHBOARD_PORT` select owned unused local ports. This exercises the current 0047 SQL registration, authentication/tenants, private uploads, decisions and browser journeys. Keep all SmartLabs flags false there. Do not reuse host 5432 or a deployed/canary database. Capture immutable container IDs/owner labels immediately on creation, check both again before `docker rm -f -v`, then read back absence; never remove foreign/unlabelled historical containers.

For the native cached decoder case set `SMARTLABS_TEST_FFMPEG` to the already-installed absolute versioned executable and record its SHA-256 before/after; no install or update. The final source runs use no dependency resolver, compiler substitution or NODE_OPTIONS. G1/T1/A1, real credits/quality/latency and production containment remain NOT RUN/UNKNOWN.

Real G1/T1/A1: NOT RUN. Real credit/latency/quality and safe backend installation remain operator gates. Parent owns independent review, eventual single PR and CI; do not self-merge or publish from this worker.
