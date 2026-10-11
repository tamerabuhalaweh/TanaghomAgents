# Correction cycle 1 — recovered review-ready freeze

Base/HEAD: `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`; branch `feature/creative-p5-talking-head`.
Current report: `docs/evidence/2026-10-11-creative-talking-head.md`.
Current receipts: this directory, not root or intermediate correction checkpoints.
Frozen patch digest and full indexed file list: immutable outside-repository receipt `p5-correction-20261011-1/review-ready-freeze.json` in the explicitly provided scratch directory. The digest is intentionally not embedded in its own hashed patch.

Authoritative historical reports: `../historical-review/p5-review-runtime.md` (FAIL) and `p5-review-database.md` (BLOCKED). Original digest is historical only. R1/R2/D1/D2 are the complete repair scope; no new provider adapter or production activation.

D1 latest authority: no P5 table CRUD grants to API or worker. Catalog and six owner-governance operations use actor-scoped SECURITY DEFINER functions. D2 validates approved provider/model/version and derives canonical ledger identity. R1 uses the original hardened downloader exact-origin option. R2 rejects metadata-only/out-of-bounds media.

Both parent-owned read-only independent reviews must pin the identical new digest and return explicit runtime PASS/FAIL and database PASS/BLOCKED. Green native tests and this 20-gate self-review cannot substitute for approval. No PR, commit, push, merge, real provider, real media upload, enrollment, spending, TTS/voice clone or deployment.

Final native logs are staged sanitized `.log.txt` copies in `native/`; raw/sanitized hashes are in `native-log-digests.json`. Synthetic snapshots contain only fixture data and retain all historical rows over down/up. Regression oracles retain their migration-target baselines; the disclosed historical video fixture correction changes only structural sample validity, not assertions.

Historical unlabeled container `67b85f4f1d492cabd52afc955eb7edf79aaf5d9b08d6bdb6ff668fd835eaa721` remains at parent disposition; fresh labeled final fixtures are removed. Foreign resources untouched. All external quality/charge/legal/custom/production gates remain closed and defaults OFF.
