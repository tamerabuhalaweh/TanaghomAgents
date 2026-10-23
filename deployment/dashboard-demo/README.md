# Tanaghom dashboard demo package (#243)

Status: local compose proof passed on 2026-10-20; not deployed. Staging deployment requires a
separate Astra GO after frozen-package review.

This package runs the existing Tanaghom dashboard against isolated demo infrastructure:

- fresh PostgreSQL 17.6 with the repository migration chain and synthetic demo fixtures;
- a private RustFS bucket for creative uploads and previews;
- a small internal RS256 auth service with the two synthetic demo accounts;
- an optional, profile-gated workspace worker that uses a private Gemini key only after explicit
  operator activation;
- the dashboard published only on loopback `127.0.0.1:3210`.

The existing canary on `127.0.0.1:3200`, production database, nginx, DNS, TLS, and all real
provider integrations are out of scope and must remain untouched.

## Local proof

```sh
bash scripts/prepare-runtime.sh /tmp/tanaghom-demo-secrets
TANAGHOM_DEMO_SECRETS_DIR=/tmp/tanaghom-demo-secrets TANAGHOM_DEMO_RELEASE=local \
  docker compose -p tanaghom-dashboard-demo -f compose.yml up -d

TANAGHOM_DEMO_SECRETS_DIR=/tmp/tanaghom-demo-secrets SMOKE_WRITE=0 bash scripts/validate.sh
TANAGHOM_DEMO_SECRETS_DIR=/tmp/tanaghom-demo-secrets SMOKE_WRITE=1 SMOKE_REJECT=1 bash scripts/validate.sh
```

The write smoke uploads a generated 1x1 PNG to the private bucket and exercises the reviewer
approval and rejection decisions. It mutates only the disposable demo database and must run on
fresh demo volumes.

## Intentional limits

- Accounts are synthetic and credentials are generated locally; never commit `secrets/`.
- The auth service is demo-only and keeps refresh tokens in memory.
- Image generation, video, segmentation, talking-head, publishing, Postiz/GHL and provider
  execution remain disabled. Disabled image generation returns `image_generation_disabled`.
- The Agency Workspace is disabled by default. Activation requires the operator to install
  `/opt/tanaghom-demo/runtime/secrets/gemini_api_key` and start the `workspace` Compose profile.
  The key is never an environment variable or image layer.
- No real database, object-store, provider, or customer credentials are used by the default demo.
- Cookies are non-Secure because the supported access path is a loopback SSH tunnel and
  `APP_ENV=demo`; do not expose this listener directly.

See `RUNBOOK.md` for deployment/rollback and `UAT.md` for the acceptance checklist.
