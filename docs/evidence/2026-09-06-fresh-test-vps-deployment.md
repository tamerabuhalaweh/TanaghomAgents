# Rebuilt CPU test VPS: deployment evidence

Owner: #200. Date: 2026-09-06 UTC. This is the newly rebuilt **155.117.45.45**
test installation, not the certified **38.247.187.232** deployment or the old
Hybrid/Postiz stack removed by Tamer's reformat.

Public test URL: https://tanaghom-test.155-117-45-45.sslip.io/login.

## Authority and isolation

Tamer authorized deployment to the reformatted test VPS, requested a public
test link, and explicitly directed continuing without a provider web console.
The replacement SSH ED25519 key was pinned before password authentication:
`SHA256:+o7Ff07bRD6k/uGzjecHFHgwyGSC1mzsn/oqfk0O15s`.
This was user-authorized trust on rebuild, not independent identity attestation.
No global known-host entry was removed or verification disabled.

Only the existing Supabase public authentication configuration was reused.
Read-only checks confirmed the existing owner's verified auth identity. The new
local business database maps that subject as its accepted human owner. No
password reset, auth-user mutation, production database connection/migration,
business-data copy, or Supabase admin-key transfer was performed.

No 38.247, SmartLabs, SmartCC, voice or Gemma service was accessed/changed by
this deployment. No n8n service was installed, model inference requested,
provider credential copied or external provider action executed.

## Reviewed source and findings

| Record | Exact source / outcome |
| --- | --- |
| PR #201 initial package | `f49777255685559645df61fc67111d9601d61289`; 40/40 checks; merged `a001060792f7a0bca2ba8edd7a33ddddec277436` |
| PR #202 tmpfs correction | `4dd347ebe19893e2e060693dcc5ab376337d3a79`; 40/40 checks; merged `2111a842896f0a13ea1d5f0582083abf069d8096` |
| PR #203 DB-login / harness correction | `380eb19c9ca77049e8c7cec0191f563c66b6b90f`; 40/40 checks; merged `9b15339bc6aed99264c7c39528cdccbf0cacac54` |
| First successful public deployment | `380eb19c9ca77049e8c7cec0191f563c66b6b90f`, validated approximately 17:29 UTC |

Technical reviews were delegated author self-reviews, not independent human
or security reviews. Branch protection/checks were not bypassed.

The first attempt initialized all 34 migrations but Docker rejected a tmpfs
entry split by an unquoted YAML comma. PR #202 quotes it and validates actual
Compose JSON, including a rejected negative fixture and a successful real
disposable-container mount probe. Syntax-only Compose validation had missed it.

The next attempt kept the dashboard private because real DB authentication
failed with SQLSTATE 28P01. SQL trim retained the password file's LF: length-only
diagnostics were 65 raw / 65 trim / 64 CR-LF-normalized. PR #203 normalizes the
generated test login and verifies real restricted authentication in a one-off
dashboard container before exposure. No password was printed. Both failed
attempts stopped dashboard/Caddy and preserved the DB, owner and secret files.

CI also exposed a race in the existing deliberate-disconnect resilience test
(#204). The checked-out client needed its own error listener before intentional
termination, plus finally cleanup. Termination, rejection, recovery and reconnect
assertions remain. Failed job `101526894313` is retained; corrected job
[`101527318832`](https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34048336052/job/101527318832)
passed. This was test-harness behavior, not a VPS/production DB outage.

## Initial runtime observations at 17:29 UTC

- Ubuntu 24.04 amd64; 3 CPUs; Docker 29.8.0; Compose 5.5.1.
- PostgreSQL 17.6, dashboard Next.js 16.2.11 / Node 24.18.0, Caddy 2.11.4.
- Exactly three project services. PostgreSQL/dashboard healthy, Caddy serving
  HTTPS; all restart counts zero, restart policy unless-stopped.
- 34 migrations through `0034_agency_pilot_integration`; business DB 15 MB.
- One accepted active human owner; zero campaigns, content items, agent jobs
  and integration connections at observation time. Later owner tests may add data.
- API role can log in, but has no superuser, CREATEDB, CREATEROLE or BYPASSRLS.
  Real password/TCP authentication and owner/campaign reads succeeded as that role.
- Both automation-platform controls remained stopped. All eleven declared
  provider/runtime activation flags false; no Supabase admin or model key mounted.
- 5,074 MiB available of 5,925 MiB RAM. Root: 103 GB total, 5.3 GB used, 93 GB
  available (6%). No failed systemd units and clean dpkg audit.
- Idle container RAM snapshot: dashboard 54.84 MiB, Caddy 14.95 MiB, PostgreSQL
  37.73 MiB. These are idle observations, not load/capacity certification.
- Host listeners: SSH 22, public TCP 80/443, local DNS. PostgreSQL/dashboard have
  no published ports. External IPv4 TCP probes connected to 22/80/443 and failed
  to connect to 3000/5432/5678/6379. This is not an outbound-allowlist claim.

Image IDs at first public release:

| Component | Immutable image identity |
| --- | --- |
| PostgreSQL | `sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94` |
| Dashboard at 380eb19 | `sha256:11ddd00c7aaeee7062667ca7e789a7340048f70941edabc1fd600dc303dd0125` |
| Caddy | `sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648` |

Docker 29 reports the built dashboard's manifest-list identity above; the build
also recorded config digest `2dc5e07a8fca500b6a9ddbbef0a7c220280a321584d5a59bb51263d51986e375`.
Do not substitute one digest type for the other.

## External and browser validation

TLS was verified without insecure options from outside the VPS. Certificate:
CN `tanaghom-test.155-117-45-45.sslip.io`, Let's Encrypt issuer YE2, valid
2026-09-06 16:30:20 through 2026-12-05 16:30:19 GMT. Renewal state is persisted
in Caddy's named volume; actual future renewal/reboot recovery was not tested.

`/api/health` returned 200 with API ready, authentication configured and database
connected. Container-side Supabase settings and ES256 JWKS reads returned 200;
email authentication is enabled. This is connectivity/configuration proof, not
a successful owner password sign-in.

All four original `tests/e2e/public-boundaries.spec.ts` checks passed externally:
login rendering, anonymous Studio redirect, anonymous Studio API rejection and
real public health. Separate fresh Chromium contexts at 1440x900 and 390x844
showed no page errors or horizontal overflow. Both empty-login screenshots
were visually inspected. The in-app browser reported no available connection;
the installed repository Playwright browser was used without saved sessions.

## Logout follow-up

An additional same-origin anonymous logout check returned 403 behind the HTTPS
proxy, while wrong-origin logout, malformed login and forged JWT rejection
worked. #205 / PR #206 changes logout to the existing proxy-aware origin guard
already used by refresh, adds positive/negative/cookie-expiry coverage, and
limits deployment to the test dashboard. The initial cookie-expiry CI assertion
used a request-cookie helper that strips attributes; it was corrected to inspect
raw Set-Cookie headers without relaxing the expiry requirement.

PR #206 passed all 40 checks at `6c8c53673e613a29441e3aba3faef431a079ba7c`,
merged at `2f3ffa6a677a878c291a3ca61029be4cd09c6d7f`. The new image was built
and privately checked before updating only the public dashboard. The updater
verified PostgreSQL and Caddy container IDs were unchanged. No migration,
role/password change, provider action or shared-auth-user mutation was made.

Final release, verified at approximately **17:44 UTC**:

- Checkout and dashboard source: `6c8c53673e613a29441e3aba3faef431a079ba7c`.
- Dashboard image ID: `sha256:65e7f102e6355adcd94f537cae936b5aef9ce5a7d8de77145d43e7664aba1bf8`.
- Dashboard image config digest: `f07e3f1e2bba7add89977bf417b21c9e61d2d6e4493a12afe352000a08072d75`.
- **5/5** public Playwright checks passed, including valid-origin logout,
  deletion-cookie attributes and missing/wrong-origin rejection. Standalone
  external checks: valid logout 200, invalid-origin logout 403, malformed login
  400, forged bearer 401. No owner password or valid user session was used.
- Desktop/mobile empty-login rendering rerun: no errors or horizontal overflow.
- 169/169 local tests; TypeScript and repository checks passed. The deployed
  exact-head CI includes the disposable direct/forwarded origin API tests.
- Database baseline/role/owner/stops and zero campaign/content/job/connection
  counts rechecked unchanged. Supabase settings/JWKS again 200 from the container.
- Three project services; healthy PostgreSQL/dashboard, serving Caddy; restart
  counts zero. Free root disk 93 GB (6% used), available RAM 5,071 MiB. No failed
  systemd units; clean dpkg audit. Idle RAM: dashboard 55.53 MiB, PostgreSQL
  37.74 MiB, Caddy 13.1 MiB. No capacity/load certification is inferred.

Exact application rollback (previous validated image retained; preserves DB
and Caddy, does not roll back schema):

```sh
cd /opt/tanaghom-test/source
TANAGHOM_RELEASE=380eb19c9ca77049e8c7cec0191f563c66b6b90f docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml up -d --no-deps dashboard
```

That older image has the known HTTPS logout defect; use rollback only for an
actual regression and record the resulting source/image mismatch explicitly.
Full test-stack stop rollback remains in the deployment package. No rollback
was needed for the successful final application update.

## Handover limits and next gate

Use the [owner walkthrough](../testing/FRESH_TEST_VPS_GUIDE.md). The owner uses
the existing Tanaghom login password, not SSH or DB credentials. Actual owner
sign-in and authenticated customer workflows remain human UAT, not claimed here.

This test installation supports manual UI and real API/database work. It does
not run n8n/Gemma campaigns, send/publish/sync providers, enable invitations,
or certify Agency profiles. Authentication is shared; business data is isolated.
Keep customer/irreplaceable data out: no off-server restore has been certified.
The OS was not fully upgraded (395 packages remained at bootstrap); this is not
a production-hardening signoff. Use the package's scoped stop rollback; never
prune or delete volumes as a substitute for a controlled recovery decision.

The free hostname/TLS need no additional domain purchase, but depend on the
retained VPS IP and third-party DNS availability; VPS hosting is not guaranteed
free or perpetual. Existing production-release evidence remains **60/100** on
[scorecard v1](../PRODUCTION_READINESS.md): a new manual test deployment does
not satisfy the certified runtime, model/provider and customer acceptance gates.
