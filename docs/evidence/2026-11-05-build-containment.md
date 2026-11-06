# Dashboard build containment — 2026-11-05

Scope: #258 (source and local image evidence only). No deployment, no live
host, no real secret. This record does not change the release scorecard and is
not a go-live approval.

## Finding

The Next.js production build warned:

```
./packages/creative-runtime/storage/contained-fs.mjs:35:32
Warning: Dynamic filesystem access causes tracing of the whole project
> 35 |         const resolved = await realpath(dir);
```

Static analysis cannot bound `realpath(dir)` because the contained-filesystem
root is runtime configuration (`CREATIVE_UPLOAD_DIR`). Before the fix, the
standalone output carried the entire dashboard source tree (3244 files, 33 MB,
including `app/`, `components/`, `lib/` and `tsconfig.tsbuildinfo`).

The warning alone was not proof of a leak: the repository root holds no
credentials, and the demo image copies only `.next/standalone`, `static`, the
`packages/*` runtime, `config`, `skills`, `prompts` and one n8n workflow. The
real exposures were (a) whole-project tracing into the server output and (b) a
`.dockerignore` that anchored `.env` patterns at the context root.

## Changes

1. `packages/creative-runtime/storage/contained-fs.mjs` — the `realpath` call
   is opted out of tracing with `/* turbopackIgnore: true */`. Containment is
   unchanged and still enforced at runtime: the root is pinned by device/inode
   and re-verified on every operation, and every key segment is still rejected
   if it is a symlink or the wrong type. The local backend remains denied in
   production by `storage/factory.mjs`.
2. `.dockerignore` — `.env` patterns are now recursive (`**/.env`,
   `**/.env.*`) and arbitrary `**/local-private` trees are excluded, so a
   nested `apps/dashboard/.env.production.local` or private working folder can
   no longer enter the build context. Certificate and key globs were
   considered and deliberately not added: no Dockerfile copies such material,
   and a blanket `**/*.pem` would hide the checked-in canary CA.
3. `scripts/verify-build-containment.mjs` (`npm run test:build-containment`) —
   plants synthetic, uniquely identifiable, non-secret canaries in every
   location a real secret could occupy, then asserts each is absent from the
   standalone output, the Docker build context, and the built runtime image.
   Canaries are removed in `finally`; no real secret is read, written or logged.

## Evidence (local, Docker 28.3.2, Node 24.22.1, Windows)

- `npm run test:build-containment` → exit 0
  - `ok standalone output: no canary content found`
  - standalone traced non-dependency files: **0** (was 3244); output is now
    `server.js` + `package.json` + traced dependencies only
  - `ok docker build context: no canary content found`
  - `ok final image: no canary content found`
  - image digest: `sha256:36f4e449315d78f2ffd6073532d1e02dab128a6ed6a957222af0b85a9a549c53`
    (recorded for the committed working tree at `bf604fe`)
- `npm run check` → exit 0 (3373 files)
- `npm run typecheck:dashboard` → exit 0
- `npm test` → exit 1 on 1 of 454 tests:
  `tests/creative-storage-boundary.test.mjs` "remote reads are streamed,
  bounded, deadline-covered, and sanitized". That fixture fails identically on
  unchanged `99a95c5` under Windows Node 24.22.1 and is already corrected in
  draft PR #255. A second fixture,
  `tests/smartlabs-adapters.test.mjs` "common native HTTP deadline…", failed on
  an earlier run of the same code and passed on two immediate reruns, so it is
  timing-sensitive rather than caused by this change. Neither is claimed as
  green.

## Not verified

- The image was built and inspected but not started (the demo entrypoint
  requires PostgreSQL and the private auth/storage services).
- No CI job runs this verification yet; it needs Docker and adds roughly five
  minutes to a run, so wiring it in is a separate CI-budget decision.
- Evidence is from one machine and one Next.js version (16.4.0 on `main`).
  Re-run after #254 lands, since it moves Next.js to 16.4.3.

## Rollback

Revert the three files above; nothing is persisted and no data migration is
involved.
