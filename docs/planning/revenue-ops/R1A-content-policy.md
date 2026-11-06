# RevenueOps R1a — deterministic communication content policy (L1)

Status: implementation candidate for issue #246. Offline-only. Not merged, not enabled, not connected to any transport.

Baseline: `origin/main` = `f2196e9a35842f7907706262ef7ff68e4e99adfa` (verified 2026-10-19).
Branch: `feature/revenue-r1a-content-policy`.

## 1. What this slice implements

A pure, deterministic L1 content validator for proposed outbound communication drafts:

- `packages/agent-runtime/content-policy.mjs` (ESM, no dependencies except `node:crypto`)
- `packages/agent-runtime/content-policy.d.ts` (hand-written declarations)
- `packages/agent-runtime/package.json` export `@tanaghom/agent-runtime/content-policy` (additive)
- `tests/revenue-content-policy.test.mjs` (39 offline tests)

Contract: `validateCommunicationContent({ subject, body }, options?)` returns a frozen result with
`layer: "L1_content"`, `content_validation_passed`, `policy_version`, `canonicalization_version`,
`reason_codes`, bounded `diagnostics`, `content_fingerprint`, `checked_rules`, `input_bytes`, and
`remaining_layers: ["L2","L3","L4","L5","L6"]`.

A passing L1 result is not authorization to send. The result shape exposes the remaining layers and
carries no verdict key such as `authorized_to_send`; tests assert the exact key set.

## 2. Policy v1 specification

Policy version: `tanaghom.communication-content-policy.v1`.

| Rule | Reason code | Default bound | Notes |
| --- | --- | --- | --- |
| Hard input bounds (UTF-8 bytes; after policy resolution, before all content rules) | `content_too_large` | subject 4,096 B / body 262,144 B | Early return; no fingerprint computed |
| Excessive combining-mark runs | `excessive_combining_marks` | 16 consecutive marks | Checked before Unicode normalization to bound ICU normalization work; early return with fingerprint |
| Subject presence | `empty_subject` | comparison representation non-empty | Whitespace-only, punctuation-only, combining-marks-only, zero-width-only and directional-mark-only subjects fail |
| Body presence | `empty_body` | comparison representation non-empty | Same comparison rules |
| Subject length | `subject_too_long` | 90 Unicode code points | Counted on the raw submitted subject |
| Body length | `body_too_long` | 220 words | Words = whitespace-separated tokens of the comparison representation |
| Merge variables | `unresolved_merge_variable` | `{{token}}` and `{token}` | Token = letters/digits/`_`/`.`/`-`/spaces, up to 64 chars |
| Malformed placeholders | `malformed_placeholder` | `{{name}`, `{name}}`, `{}`, `{{}}`, unterminated `{` | Reported with a bounded snippet |
| Link count | `too_many_links` | 1 | Counts `http://` and `https://` occurrences in the body, case-insensitive |
| HTML restriction | `unsupported_html` | none allowed | `<` followed by an ASCII letter or `/`; closing `>` must appear inside a bounded scan window of 200 units after the tag name |
| Hidden control characters | `hidden_control_characters` | none allowed | Rejects U+00AD, U+200B–U+200D, U+202A–U+202E, U+2060, U+2066–U+2069, U+FEFF |
| Banned phrases | `banned_phrase` | 29 defaults (EN + AR), configurable | Token-boundary matching after comparison normalization; separators (`-`, `_`, `*`, `/`, `\`, `|`, `+`, `=`, `~`, `^`, `&`, `@`, `#`, `%`) and directional marks act as separators; a second mark-removal comparison also runs for phrases |

Comparison representation (never written back to the submission): NFC, combining marks removed,
tatweel U+0640 removed, Arabic-Indic digits (U+0660–U+0669) and Extended Arabic-Indic digits
(U+06F0–U+06F9) folded to ASCII, hidden control characters removed, directional marks U+200E,
U+200F and U+061C mapped to spaces, lowercased, sentence punctuation and common separators
replaced with spaces, whitespace collapsed. For banned-phrase matching a second representation
with directional marks removed instead of spaced is also checked, so mark insertion cannot split
a phrase. Directional marks remain allowed in the submitted text.

The byte-cap check runs before the combining-mark run check, which runs before any Unicode
normalization; over-cap input returns immediately. The validator early-returns before any
Unicode normalization when a run exceeds the threshold, and the comparison helper itself skips
NFC composition for such runs (marks are stripped anyway) and enforces the body byte cap with a
`RangeError` above it, so no public entry point reaches pathological normalization work.

Tatweel and harakat evasion of banned phrases is folded away before matching. Arabic-Indic vs
ASCII digit variants compare equal under normalization but produce different fingerprints because
the fingerprint hashes the raw submitted bytes.

Content fingerprint: `sha256:` + SHA-256 hex of the UTF-8 canonical JSON
`{"body":...,"canonicalization_version":"tanaghom.canonical-json.v1","policy_version":...,"subject":...}`
(alphabetical keys, no insignificant whitespace, raw non-normalized values). Custom policy
overrides must declare a new `policy_version`; this keeps verdicts and fingerprints reproducible
per version.

Known v1 limitations (documented, not hidden):

- Phrase matching is exact after normalization, so inflected Arabic forms and spaced phrase
  variants (e.g. `عرض خاص` vs `عرضاً خاصاً`) are not matched.
- Compatibility variants (fullwidth Latin, ligatures, visually confusable homoglyphs) are not
  folded; only canonical (NFC) normalization runs.
- Single-word defaults such as `winner` and `congratulations` can flag legitimate text such as
  contest announcements; policy owners should configure `banned_phrases` per use case.
- A lone `{` in ordinary text is treated as a malformed placeholder attempt; JSON-like snippets in
  a body will be flagged.
- Word counting treats separator characters as spaces, so a hyphenated word counts as two words.
- Only the listed separators act as separators; other visible symbols (e.g. `$`, `·`, `。`) are
  not, so `act$now` is not matched as `act now` (visible-character evasions are lower risk than
  the invisible-mark evasions, which are folded).
- Only `http(s)` links are counted; other URL schemes are not links for this rule.

## 3. Contract corrections recorded during this slice

These correct assumptions that appeared in earlier planning notes; none of them change here.

1. `organization_agent_invocation_approvals` has no `expires_at`; expiry is derived at approval
   time (migration `0030_policy_resolved_agent_runtime.up.sql:1420-1421`).
2. GHL action approvals bind `ghl_action_jobs` (migration `0015_governed_ghl_actions.up.sql:135-146`);
   approvals cannot be attached to arbitrary provider-neutral drafts without a new contract.
3. Platform skill versions require executor type/ref/version, package path, permission manifest
   and content hash (migration `0026_skill_registry.up.sql:90-101`).
4. `leads.ghl_contact_id` is nullable (migration `0001_shared_foundation.up.sql:275`).
5. Legacy MD5 fingerprints exist in older tables (`0013_sales_knowledge_intelligence.up.sql:39,96`;
   `0015_governed_ghl_actions.up.sql:90`); the content fingerprint here is SHA-256 and must not be
   compared with legacy MD5 values without a conversion boundary.
6. Local uniqueness is not exactly-once external delivery: `external_operations` carries an
   `indeterminate` state (enum at `0001_shared_foundation.up.sql:317`) with reconciliation in
   `0016_ghl_action_review_reconciliation.up.sql:88-103`. No L1 verdict may be treated as
   delivery evidence.

Migration numbering context: files 0001–0047 (0041–0043 absent). This slice adds no migration and
the next free number (0048) is deliberately untouched.

## 4. Layer interfaces (design only — not implemented here)

| Layer | Responsibility | Future interface sketch |
| --- | --- | --- |
| L2 | Recipient authorization (consent, suppression, DNC) | `evaluateRecipientAuthorization(candidate, fingerprint)` |
| L3 | Campaign authorization (goals, budgets, brand) | `evaluateCampaignAuthorization(candidate, fingerprint)` |
| L4 | Approval binding (human or policy approval) | `evaluateApprovalBinding(candidate, fingerprint)` |
| L5 | Delivery policy (windows, throttles, locale) | `evaluateDeliveryPolicy(candidate)` |
| L6 | Transport admission and idempotent send | `admitTransport(candidate, allVerdicts)` |

Each future layer returns its own verdict object; transport admission (L6) would require all six
layers to pass for the same `content_fingerprint`. None of these layers exist yet; this document
only fixes the L1 boundary so the later slices can bind to a stable fingerprint.

## 5. Test coverage matrix (required categories → tests)

| Required case | Test |
| --- | --- |
| Valid English | `valid English draft passes every v1 rule with a verifiable fingerprint` |
| Valid Arabic | `valid Arabic draft passes with RTL mark, Arabic punctuation and Arabic-Indic digits intact` |
| Mixed AR/EN | `mixed Arabic and English draft passes` |
| Empty subject | `empty subject fails with empty_subject`, `whitespace-only subject fails as empty`, `combining-marks-only subject fails as empty` |
| Empty body | `empty body fails with empty_body` |
| Excessive subject length | `subject of exactly 90 code points passes while 91 fails` |
| Excessive body length | `body of exactly 220 words passes while 221 fails` |
| Unresolved merge variables | `double-brace merge variables are flagged as unresolved in English and Arabic`, `single-brace merge variables are flagged as unresolved` |
| Malformed placeholders | `malformed placeholder variants are rejected as malformed_placeholder` |
| Too many links | `two or more body links fail while a single link passes` |
| Unsupported HTML | `HTML markup fails while literal angle brackets without tag syntax pass` |
| Banned terms (EN) | `default English banned phrases are detected including case variants` |
| Banned terms (AR) | `Arabic banned phrases are detected including tatweel and harakat evasion` |
| Evasion resistance | `directional marks inside banned phrases are treated as separators for matching`, `separator substitution does not evade banned phrases` |
| Combining-mark run abuse | `excessive combining mark runs are rejected before normalization work` |
| Helper-path abuse | `the exported comparison helper is bounded and skips composition on pathological mark runs` |
| False positives (EN/AR) | `legitimate English and Arabic sales copy does not trigger false positives` |
| Combining marks | `Unicode combining marks inside words are normalized for comparison, not rejected` |
| Arabic numerals | `Arabic-Indic digits are preserved in the submission while comparison folds them to ASCII` |
| Unicode edge cases | `hidden control characters are rejected with code point diagnostics`, `allowed directional marks do not trip the hidden character rule` |
| Large malicious input | `excessive payload fails fast under content_too_large without a fingerprint`, `large adversarial input under the cap completes deterministically without pathological behavior` |
| Determinism | `repeated validation of identical input is byte-deterministic`, `reason code order is stable and deduplicated` |
| Immutability | `submitted input is never mutated` |
| Policy version changes | `policy overrides that declare a new version change verdicts and fingerprint` |
| No network/provider deps | `the module imports only node:crypto and contains no transport, filesystem or secret access` |
| Pass ≠ send | `result shape exposes an L1 layer and remaining layers so a pass cannot be read as dispatch authorization` |
| Bounded diagnostics | `diagnostics are bounded to eight entries` |

## 6. Provenance and attribution

Behavior family adapted (re-implemented in ESM with new defaults, Arabic-first normalization,
bounded input handling and SHA-256 fingerprinting; no code copied verbatim) from Harvey
`harvey/gate.py`, commit `e114e95471b1bf155454fca108f0730b66a47a01`,
https://github.com/ethanplusai/harvey, MIT License, Copyright (c) 2026 Ethan Rogers.

Adapted behaviors: non-empty subject/body, bounded subject/body length, merge-variable detection,
maximum link count, plain-text/HTML restriction, configurable banned phrase list.

Changed from the upstream defaults: all bounds are explicit v1 constants here; new English and
Arabic banned phrase list; Unicode normalization and bidi/zero-width handling; hard byte caps
checked before any other work; diagnostics and fingerprinting added; no LLM or network code of any
kind. No Paperclip code is used. No `tech_detect.py` code is used.

## 7. Verification log

Local results (Node v22.18.0, npm 10.9.3, worktree of `f2196e9`):

| Command | Result |
| --- | --- |
| `node --test tests/revenue-content-policy.test.mjs` | 39 tests, 39 pass, 0 fail |
| `npm test` | 484 tests, 483 pass, 1 skipped (pre-existing skip outside this slice), 0 fail |
| `npm run check` | Repository verification passed |
| `npm run typecheck:dashboard` | Passed (`tsc --noEmit`) |
| `npm run build:dashboard` | Passed (Next.js production build) |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| Static import scan (test) | Only `node:crypto`; no `fs`, `net`, `tls`, `dns`, `child_process`, `fetch`, `process.env` |
| Combining-mark DoS probe | Exact adversarial repro (`"\u0301\u0316"` pairs to the 262,144-byte cap) rejected by the validator in ~3 ms and normalized by the exported helper in ~10 ms; pre-guard measurements were ~26,500 ms (validator path) and ~23,000 ms (helper path), which is why the run guard exists on both |

Security reviewer round 1 blocked on the normalization DoS and on directional-mark/separator
phrase evasion; all three were fixed in the module and covered by regression tests, then the
frozen candidate was re-reviewed. Hosted CI status and reviewer verdicts are appended in the
issue #246 handoff comment before the draft PR is marked ready.
