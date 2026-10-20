# Creative storage boundary (issue #245 correction)

Status: accepted for the #245 corrective PR (2026-10-13 senior directive).
Supersedes the `/data/tanaghom/assets` deployment assumption recorded in the
older `0022-creative-assets-storage.md` runbook path; those runbooks,
Compose files, and deployment branches are intentionally not edited here.

## Decision

1. One server-side factory selects the creative object-storage backend:
   `@tanaghom/creative-runtime/storage/factory` (re-exported by
   `apps/dashboard/lib/server/creative/storage.ts`). Dashboard routes and
   worker CLIs never construct a backend directly.
2. `CREATIVE_STORAGE_BACKEND` is explicit: `local` or `s3`. Missing, empty,
   or unknown values fail closed. There is no ambient default and no mode
   in which an unset backend silently selects local storage.
3. `local` is development/test/harness only. Any production signal
   (`NODE_ENV=production` or `APP_ENV=production`) denies it, and
   constructor options can never downgrade that denial. Production must use
   an explicit private S3-compatible bucket. Next.js preserves an explicitly
   supplied `NODE_ENV`; local-backed integration harnesses that boot
   `next start` therefore set `NODE_ENV=test` explicitly, while production
   deployments keep deriving the signal from their real environment
   (`APP_ENV=production` in the Compose files, or `NODE_ENV=production`).
   A harness that boots with `NODE_ENV=production` must use the private S3
   backend instead.
4. Local containment is static, not race-free: the root is pinned by
   device/inode and re-verified per operation, every key segment is
   rejected if it is a symlink (including Windows junctions), and reads are
   bounded. Node offers no `openat`-class confinement, so a local backend
   can never be proven race-free; its production eligibility is DENIED.
   The original race-case evidence stays RED and must not be edited. A
   future local alternative is design-only work, not part of this repair.
5. Remote reads are streamed and bounded: the limit is validated before
   I/O, `Content-Length` must be a well-formed non-negative integer, actual
   streamed bytes are counted, and oversize/deadline/error paths abort and
   release the body without accepting partial data. `arrayBuffer` is not
   used. Default ceiling 100 MiB (`MAX_OBJECT_READ_BYTES`), matching the
   largest governed provider artifact.
6. Object creation is immutable: PUT is signed with `If-None-Match: *` and
   only enabled when the operator declares
   `CREATIVE_STORAGE_S3_CONDITIONAL_WRITES=verified` for a pinned provider.
   Duplicate create is refused (412 -> `object_key_exists`); 409/501 fail
   closed with no auto-retry and no HEAD-then-unconditional fallback.
7. Object keys are strictly gated before any I/O:
   `t/<uuid>/<capability>/<uuid>/v<N>.<ext>` with supported capabilities
   and extensions only; traversal, percent-encoding, double separators,
   malformed UUIDs, and bucket escapes are rejected. The database
   predicate keeps its own legacy pattern unchanged.
8. Credentials follow the #242 server-only convention (direct value or
   absolute `_FILE`, never both; direct and file values share the same
   1..4096 printable-ASCII bound; generic errors; never echoed). Presigned
   URLs keep the existing 60..3600 s TTL bounds and are preview hints only,
   never the canonical identity. Anonymous/invalid access must be denied by
   the pinned provider (verified in the disposable harness). Endpoints may
   be `https` or `http`: private in-VPC S3-compatible services over plain
   HTTP are a supported deployment, and transport/provider privacy policy
   remains an explicit operator profile acceptance. Loopback hosts
   (`localhost`, `127.0.0.0/8`, `::1`, IPv4-mapped loopback) are refused
   whenever production mode is detected.
9. The local race robustness and static containment tests remain as-is
   (assertions not weakened), with test contexts explicitly marked
   non-production. The old `/data/tanaghom/assets` path assumption is
   superseded by this document.

## Audit: direct local construction sites

Production paths: none (all dashboard routes and worker CLIs go through the
factory). Non-production, intentionally direct: integration/disposable
harness scripts (`scripts/creative-*-integration.mjs`,
`creative-talking-head-crash-probe.mjs`, `creative-foundation-integration.mjs`)
and unit tests. These are development/harness code and cannot run in
production deployments.
