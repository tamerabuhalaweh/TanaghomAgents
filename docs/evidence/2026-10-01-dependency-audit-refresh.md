# Dependency audit refresh (follow-up to #192)

Date: 2026-10-01. Branch: `readiness/00-dependency-audit`. Source only; this is
not deployment evidence and does not change the production score.

## Trigger

`dashboard-contract` (`npm audit --audit-level=moderate`) began failing on every
new pull request against `main` at `b3e8619` after new advisories were published:

| Package | Was | Advisories | Now |
| --- | --- | --- | --- |
| next (both workspaces) | 16.2.11 | critical: GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j (range ≤16.3.5) | 16.3.8 |
| sharp (override) | 0.35.3 | high: GHSA-rgj7-g3m4-5g8c (libheif) | 0.35.5 |
| fast-uri (override) | 3.1.6 | high: GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g, GHSA-hrr3-gc8f-f4qj | 3.1.8 |
| baseline-browser-mapping (transitive) | 2.10.43 | moderate: GHSA-w5vr-8v7q-w6rv | 2.11.26 |

Next.js has no patched 16.2.x release, so this is a minor framework update
(16.2 → 16.3), unlike the patch-only #193 remediation. Lockfile changes are
limited to these packages, their platform binaries, `@next/env`, `@swc/helpers`
and `@emnapi/runtime`.

## Local verification (Linux arm64, Node 22.12)

- `npm audit`: 0 vulnerabilities (was 1 critical, 3 high, 1 moderate).
- `npm test` 175/175, `npm run check`, `npm run typecheck:dashboard`,
  `npm run build:dashboard` (Next.js 16.3.8) and
  `npm run test:agency-quality-preparation` pass.

## Frozen evaluation locks

`evaluation/agency-v1/source-lock.json` pins `package-lock.json`, and the runner
lock pins that file. The second commit is a **proposed** dependency-only
re-freeze: exactly one hash changes in each lock; no corpus, rubric, prompt,
schema, adapter or runner source changed. Per the evaluation runbook a freeze
needs reviewer acceptance; reject the second commit if the #177 owner prefers a
different freeze procedure (CI will then fail those lock tests until decided).

## Deployment

Hosts still run whatever image they were built from. The release preflight
(`readiness/02`) `production_dependency_audit` check will report this until a
reviewed deployment rebuilds with this lockfile.
