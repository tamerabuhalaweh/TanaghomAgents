# Dependency audit remediation (2026-10-07) — unblocks docs PRs #222/#223

Source-only remediation. No deployment performed; production is **not**
claimed patched by this document. Follows the #192/#193 precedent
(`docs/evidence/2026-09-06-dependency-audit-remediation.md`).

## Scope and release state

The `dashboard-contract` CI job (`npm audit --audit-level=moderate`,
`.github/workflows/quality.yml:587`) fails on both docs-only PRs #222 and
#223 with 5–6 findings (1 moderate, 3–4 high, 1 critical). The failure is
pre-existing advisory drift — neither PR changes dependencies — and blocks
the P0 procedural closeout (merge #223, rebase #222). This fix performs the
smallest compatible patch only: no server connection, database migration,
provider operation, workflow activation, or protected-service change.
Source rollback is a reviewed revert of this commit; deployment and image
rollback require a separate release package.

Baseline: `origin/main` at `b3e8619`.

## Findings and smallest compatible patch

Audit reproduced locally on 2026-10-07 (`npm audit --audit-level=moderate`:
5 findings; CI fresh-install tree reports 6 — advisory metadata is
time/tree-dependent; neither count proves exploitation).

| Dependency | Before | After | Decision |
| --- | --- | --- | --- |
| fast-uri override, through Ajv (`ajv@8.18.0` requires `^3.0.1`) | 3.1.6 | 3.1.8 | Latest 3.x patch covering GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g, GHSA-hrr3-gc8f-f4qj; stays inside Ajv range (4.x would violate it) |
| Next.js, root + dashboard workspace | 16.2.11 | 16.4.0 | Same major 16 — no framework upgrade; audit-suggested fix for GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j; React stays 19.2.7 |
| sharp, root pin + `$sharp` override | 0.35.3 | 0.35.5 | Same 0.35 line; covers GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w |
| source-map-js, through PostCSS | 1.2.1 | 1.2.2 | Plain `npm audit fix` (no `--force`); covers GHSA-68fv-2mgg-jv7q |
| postcss / nanoid | 8.5.23 / 3.3.18 | unchanged | Already patched, verified unchanged in lockfile |

No audit exception, no threshold relaxation, no `--force` major update
(`next@16.4.0` is within major 16; `npm audit fix --force` was explicitly
avoided), no new network permission.

## Verification

- `npm install` + `npm audit fix` (no force) then
  `npm audit --audit-level=moderate` → **found 0 vulnerabilities** (exit 0,
  the exact CI gate).
- `tests/repository.test.mjs` version pins updated to 3.1.8 / 16.4.0 /
  0.35.5 (postcss 8.5.23, nanoid 3.3.18 unchanged and re-asserted).
- Targeted suites: `tests/dependency-security.test.mjs` and
  `tests/repository.test.mjs` (results recorded in PR body/CI).
- Full matrix (typecheck, dashboard build, contract suites) runs in CI on
  the fix PR; deployment patching remains a separate gate per STATUS.md.

## Advisory references (ranges relevant to this lockfile)

- GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g, GHSA-hrr3-gc8f-f4qj (fast-uri)
- GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j (next)
- GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w (sharp)
- GHSA-68fv-2mgg-jv7q (source-map-js)
