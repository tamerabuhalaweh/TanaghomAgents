# Issue #192: patch-only dependency remediation

Source acceptance update: all **38/38** jobs passed in
[run 34013675646](https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34013675646).
Implementation commit `190c32e6806f465fea89d9be8477b764a4bca3d0`; PR #193
merged at 2026-09-06T05:24:12Z as `91fa3a4411dc6e4fbcbc8f9d125f26659569ce9a`.
This satisfies source acceptance only; no deployment was performed.

## Scope and release state

Tamer authorized targeted remediation on 2026-09-06, followed by the planning
PR and six-profile pilot. This is source remediation only: no server connection,
database migration, provider operation, workflow activation, or protected-service
change. Production is **not** claimed patched by this document. Source rollback
is a reviewed revert of this remediation commit; deployment and image rollback
require a separate Tanaghom-only release package.

Baseline: `0b5b5a761099e6eb6163efbeb00a75d891d680c7`.
The documentation-only PR #191 did not change dependencies. Its run
[34013158566](https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34013158566)
finished with 37 successful jobs and the dashboard audit failure.

## Findings and smallest compatible patch

Audit reproduced on 2026-09-06 around 05:12 UTC using Node 22.18.0/npm 10.9.3.
The earlier GitHub audit reported five entries (including dependent ajv);
the local re-query reported four entries (fast-uri, nanoid, postcss, dependent
next). Advisory metadata is time-dependent; neither count proves exploitation.

| Dependency | Before | After | Decision |
| --- | --- | --- | --- |
| fast-uri override, through Ajv | 3.1.4 | 3.1.6 | First 3.x patch covering all observed URI findings |
| PostCSS direct pin/existing override | 8.5.18 | 8.5.23 | First patch covering the source-map finding |
| Nano ID, through PostCSS | 3.3.16 | 3.3.18 | Fixed 3.x generator implementation, compatible with PostCSS range |
| Next.js, both workspaces | 16.2.11 | unchanged | No framework upgrade needed after existing PostCSS override is patched |

Only these three installed package versions change. No audit exception,
threshold relaxation, forced major update, or new network permission.

Primary advisory review (3.x/8.x ranges relevant to this lockfile):

- [Backslash authority confusion](https://github.com/fastify/fast-uri/security/advisories/GHSA-7p8r-x3mc-p8w7): fast-uri >=3.0.0 <3.1.5; fixed 3.1.5.
- [Scheme-relative IDN host confusion](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8): >=3.1.3 <3.1.6; fixed 3.1.6.
- [Malformed IPv6 normalization](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc): >=3.0.0 <3.1.6; fixed 3.1.6.
- [Repeated host percent-decoding](https://github.com/fastify/fast-uri/security/advisories/GHSA-fph4-wmhf-6fwf): >=3.1.2 <3.1.6; fixed 3.1.6.
- [Encoded scheme normalization](https://github.com/fastify/fast-uri/security/advisories/GHSA-jqff-g426-hqxp): >=3.0.0 <3.1.6; fixed 3.1.6.
- [Nano ID zero-sized custom generators](https://github.com/advisories/GHSA-2v37-7h3g-55p8): <3.3.18; fixed 3.3.18 on the retained major.
- [PostCSS untrusted source-map path](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp): <=8.5.22; fixed 8.5.23.

Applicability assessment from this source checkout, **not a production scan**:

- Ajv/fast-uri are development/schema-validation dependencies. Provider URL
  validation in `apps/dashboard/lib/server/integration-providers.ts` uses Node's
  `URL` and an exact normalized allowlist, not fast-uri. No direct fast-uri
  provider-routing use was found. Schema/reference behavior still needs regression
  testing; low observed reachability does not justify ignoring the audit.
- PostCSS participates in Next's CSS build. No application endpoint that compiles
  customer-supplied CSS was found. The source-map vulnerability matters if untrusted
  CSS reaches processing without a base filename and output maps are exposed.
- Nano ID is transitive through PostCSS. PostCSS's input identifier uses a fixed
  size of six, and no application use of attacker-controlled custom-generator size
  was found. A bounded child-process regression tests the vulnerable API directly.
- This patch does not assess or modify dependencies inside a deployed n8n image.

## Reproduction and validation

Manifest edited deliberately, then lockfile generated with:

```sh
npm install --package-lock-only --ignore-scripts
npm update nanoid --package-lock-only --ignore-scripts
npm ci
npm audit --audit-level=moderate
npm run check
npm test
npm run typecheck:dashboard
node node_modules/next/dist/bin/next build apps/dashboard
```

Local results on 2026-09-06: clean install PASS; unchanged audit gate PASS,
zero reported vulnerabilities; repository check PASS; 115/115 tests PASS;
typecheck PASS; production build PASS (51 prerendered pages).

Four new executable regressions cover an absolute untrusted source-map reference
(including a trusted positive control using a synthetic fixture), zero-sized
Nano ID generators with a five-second child-process timeout, IDN resolution,
and nested hostname encoding. Existing schema safety tests still pass.

The standalone workspace build command initially failed because the existing
Next configuration derives Turbopack root from `process.cwd()`. The root-launched
command above matches the repository launcher without loading the ignored root
`.env` and passes. No configuration change was needed or made.

Existing Chromium public-boundary tests: **3/3 PASS** against loopback port 3139,
no credentials: login rendering/no browser errors, anonymous Studio redirect,
anonymous Studio API 401. The database-connected health case was intentionally
not selected locally; it requires disposable database/auth configuration. The
temporary server was stopped. No live customer UAT was performed.

Full GitHub regression jobs must pass on the remediation PR before source
acceptance. Record their exact run and commit in the PR/issue; local success
alone does not close #192. The CI includes disposable database/API, workflow,
certification, queue resilience, and image-build checks.

## CI billing finding and contingency

The repository is public; current jobs use standard `ubuntu-latest` runners.
The observed failure is the audit, **not billing**. GitHub documents standard
public-repository runner usage as free, and Actions usage as charged to the
repository owner rather than whoever triggers it:
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Signing in with a backup account would not change billing for this repository.
No account switch, budget change, repository transfer, mirror, or runner
registration was performed. If a real billing/runner block appears, preserve
the error and use locally reproducible checks as supplemental evidence; then
choose an approved isolated self-hosted runner or correct the owner's billing.
Never install CI runners on the protected GPU/SmartLabs server or fake green
required checks. A separate runner/account resource requires its own reviewed
ownership, access, and cost decision.
