# Fresh CPU test deployment — Issue #200

Authorized by Tamer on 2026-09-06 after he rebuilt VPS 155.117.45.45. This is
an additional test installation, not a relocation/update of certified 38.247.
Existing pre-format health evidence is historical. The freshly observed host
has Ubuntu 24.04 amd64, 3 CPUs, 5,925 MiB RAM, ~96 GB free disk and no Docker or
failed systemd services. Recheck before installation.

## Access and scope

Tamer explicitly accepted trusting the replacement SSH identity after the
reformat without a provider console. ED25519 fingerprint:
`SHA256:+o7Ff07bRD6k/uGzjecHFHgwyGSC1mzsn/oqfk0O15s`.
Pin that exact key before sending credentials; refuse further drift. This is
user-authorized trust on rebuild, NOT independent out-of-band verification.
Preserve the previous known-host record; never disable SSH verification.

- Existing dashboard code and all 34 migrations, applied ONLY to a new local
  `tanaghom_test` PostgreSQL database. Do not load the developer DATABASE_URL.
- Existing Supabase email/password authentication: copy only URL, publishable
  key and public JWKS URL. Map only the read-only-verified owner subject into
  the new database. Do not change that user's password or production records.
- Do not transfer the Supabase admin key. New user invitations are unavailable
  in this first isolated installation; existing owner sign-in is retained.
- Fresh encryption/worker keys; no copied provider credentials, campaigns,
  approvals, leads or customer data. No fabricated model/certification results.
- No n8n deployment/activation, Gemma calls, shared-model schema experiments,
  Postiz/GHL sends, or changes to 38.247/SmartLabs/SmartCC/voice.

This delivery supports UI, real API/database and owner-led manual testing. It
does not complete automated campaign generation, new Agency-profile model
certification or live-provider UAT. Those remain separate #177/#125 gates.

## Components and limits

Three containers: PostgreSQL (768 MiB / 0.75 CPU), dashboard (1,024 MiB / 1 CPU),
Caddy (192 MiB / 0.25 CPU): total maximum 1,984 MiB / 2 CPUs at runtime. Build
resource use is separate: perform one build at a time with no other test stack.
Images are digest-pinned; the dashboard tag is the exact source commit and its
built image ID must be recorded. Bounded container logs: 3 x 10 MB each.

Only Caddy publishes TCP 80/443. PostgreSQL and dashboard have no published
ports; the database-only bridge is internal. The edge bridge permits outbound
HTTPS for Supabase and certificate issuance; it is NOT an outbound allowlist.
Do not claim this boundary is suitable for arbitrary untrusted agent tools.

APP_ENV=production is required for secure cookies, even though the data is a
test workspace. All provider/runtime activation flags remain false and database
platform stops remain at their migration defaults.

## Provision and release

Use `bootstrap-host.sh` only on the verified empty host. It refuses an existing
Docker installation or target directory. It installs Docker from its signed
official Ubuntu repository. Record installed package versions. Do not disable
TLS validation, add users to docker, change SSH settings or run global prune.

Checkout the exact reviewed source under `/opt/tanaghom-test/source`. Set
`TANAGHOM_RELEASE` to its full 40-character commit for every Compose command:

```sh
cd /opt/tanaghom-test/source
export TANAGHOM_RELEASE="$(git rev-parse HEAD)"
docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml config --quiet
```

Create files once in root-owned mode-0700 `/opt/tanaghom-test/runtime/secrets`.
Generate separate random PostgreSQL/admin, API-login, encryption and worker
secrets; never overwrite existing ones. Dashboard files are root:1000/0640.
PostgreSQL's two mounted password files may be 0644 inside the protected 0700
directory to support its image-specific uid. Never print values or put them in
Git, CLI arguments, logs or Compose environment entries. Do not upload `.env`.

Start PostgreSQL only, wait for health, apply unapplied `.up.sql` files in order
through its LOCAL Unix socket using `docker compose exec -T postgres psql`.
Every migration is transactional and recorded in `public.schema_migrations`.
Stop on failure and preserve the database; do not drop/recreate it automatically.
Bootstrap the verified owner using `bootstrap-owner.sql` and psql variables
`owner_email` and `owner_subject` (not authentication credentials).

Build the dashboard from the secret-free checkout, record image ID, then start
dashboard and Caddy. Caddy persists certificates and automatically renews TLS.
Use `validate.sh` for HTTP/DB/flag/port checks. Browser sign-in requires the
owner's existing password; never substitute a test authentication stub publicly.

## Test link and persistence

Expected URL: `https://tanaghom-test.155-117-45-45.sslip.io`.
It is a normal public HTTPS endpoint, not a workstation tunnel. Its hostname
and certificate have no additional purchase cost; VPS service is not claimed
free. The hostname depends on the retained IP and third-party DNS service, so
it is not guaranteed permanent. Containers restart after reboot; named PG and
Caddy volumes survive recreation. Losing/reformatting the VPS still loses data.
Do not enter irreplaceable customer data: no off-server data recovery has been
certified for this disposable test environment.

## Rollback

Stop ONLY this installation, preserving all database/certificate volumes:

```sh
cd /opt/tanaghom-test/source
export TANAGHOM_RELEASE="$(git rev-parse HEAD)"
docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml stop caddy dashboard postgres
```

This removes public access and stops the test database without deleting data.
Never use `down -v`, broad removals or prune. For a failed first deployment,
retain logs and source/secrets for diagnosis. A later update needs its own
reviewed migration/data rollback; this initial package creates no rollback
authority over the existing 38.247 deployment or shared Supabase project.
