# Issue 242 — CI fixture portability correction

Scope: existing draft PR244, branch `feature/smartlabs-server-adapters`. No commit, push, new PR, workflow change, live provider request, deployment, or migration execution.

## Minimal correction

Only `tests/smartlabs-secret-config.test.mjs` and `tests/smartlabs-server-factory.test.mjs` change executable test source. Each imports `tmpdir` from `node:os`; the four fixture allocations use `process.env.TMPDIR ?? tmpdir()` as the parent of their existing unique `mkdtemp` directory. Explicit TMPDIR remains honored on Windows as well as Linux. Existing owned-directory creation and `t.after` recursive cleanup stay intact. No assertion, deadline, test case, skip rule, runtime, SQL, authorization, guard, secret loading behavior, lockfile, dependency, or workflow changes.

## Results

- Original native Windows Node22.18.0 targeted suite, TMPDIR absent and cwd/tmp absent: 25 tests, 21 pass, the exact four hosted fixture failures, zero skips.
- Exact original committed LF source in Linux Node24.18.0: same targeted RED, 25/21/4/0.
- Corrected targeted suites: 25/25/0/0, normal and TMPDIR absent, native and exact Linux source.
- Corrected full `npm test`: 445/445/0/0, normal and TMPDIR absent, native and final clean Linux source.
- Native repository check, dashboard typecheck, production dashboard build, restored-byte typecheck/check, and online `npm audit --audit-level=moderate`: exit0. Audit reports zero vulnerabilities.

Hosted run38250618561 was 42/43 jobs passing; its repository-contract log is preserved here with ANSI escapes and host paths sanitized, not regenerated. Hosted npm test was 445 total, 440 pass, four fixture failures, one skipped decoder case. That skip is the unchanged `skip: !process.env.SMARTLABS_TEST_FFMPEG` condition in `tests/smartlabs-adapters.test.mjs`; the executable was not supplied in the hosted environment. Native and Linux full runs explicitly supplied an executable, and the existing test SHA256-pinned it, so all445 ran with zero skips. This correction deliberately does not change that skip rule or CI.

## Clean Linux execution and isolation

Cached image `node:24.18.0-bookworm`, immutable image ID recorded in linux-isolation.json. Fresh source archive contains all workspace metadata/package-lock; dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund` (no npm install or globals). Locked TypeScript5.9.3 and pg8.16.3 resolved locally. OS ffmpeg installed during network preparation and its exact executable SHA256 recorded. Networking disconnected before GREEN test execution; only existing loopback provider-shaped stubs used. No server started. Private /tmp is a bounded64MiB tmpfs owned by the disposable labelled container; Unix `os.tmpdir()` truly resolves there with TMPDIR absent. Native children instead explicitly set TEMP and TMP to owned Hermes scratch before removing TMPDIR, and actual os.tmpdir() resolution is recorded.

The initial archive-only Linux full runs found two existing executable-file-mode tests requiring a real Git index (443pass/2fail, not product failures). Those failed logs remain preserved as `linux-green-full-normal.log` and `linux-green-full-tmpdir-absent.log`; they are NOT acceptance runs. A genuine isolated index was reconstructed from all tracked source files, not mocked outputs, retaining executable modes. Windows git archive also honored host core.autocrlf; it was regenerated with `git -c core.autocrlf=false archive HEAD` for exact committed blob bytes. `linux-source-parity.json` proves all1774 original index entries/modes match except the two corrected tests. Final acceptance is `linux-green-full-clean-*` and `linux-green-targeted-exact-*`.

Windows extraction initially hit the long-path limit in historical evidence; archive extraction was moved wholly into the owned Linux container. Production build generated an extra declaration in next-env.d.ts; its diff was recorded then that generated file was restored to its exact original bytes. Post-restore check and typecheck pass. This file is not in the correction.

Container cleanup checked the exact ID and ownership label before removal, then verified both the ID and label were absent. Targeted fixture directories are absent on native and Linux paths; repository cwd/tmp was never created.

## Lineage and review boundary

Baseline main remains `b81e01e5c9d3b5486632569014008aabf11a01f1`; HEAD remains `046dfa3ec051e1407210af658fcaef7f1133bcee`. Original approved full freeze `0408e5154688479d31b10f240316683252da4922fcaa4fd35375e8febabaf428` is unchanged. Original177 approved-index blob hashes are independently compared to HEAD and the correction index in lineage.json; exactly175 remain equal and only the two permitted tests differ. Tracked raw-byte hashes before and after prove every other original file, including production/SQL, is unchanged. Historical fresh PostgreSQL/browser/security PASS therefore remains evidence at those unchanged production bytes, not a claim those layers were rerun here.

Final immutable manifest and patch hash definitions live outside the candidate to avoid self-reference, at owned scratch `smartlabs-242-ci-portability-freeze.json` and `smartlabs-242-ci-portability-handoff.md`. Both hash definitions are SHA256 of exact binary stdout bytes, with no text/newline normalization:

1. Incremental correction: `git diff --cached --binary --full-index 046dfa3ec051e1407210af658fcaef7f1133bcee`.
2. Full candidate: `git diff --cached --binary --full-index b81e01e5c9d3b5486632569014008aabf11a01f1`.

Independent reviews must use both final hashes. Parent alone may commit/push the existing PR after review; a push automatically starts new hosted CI (no manual rerun). No hosted GREEN is claimed yet. No prior historical evidence or freeze artifact was overwritten.
