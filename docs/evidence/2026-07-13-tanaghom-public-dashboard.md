# Tanaghom public dashboard deployment evidence

Date: 2026-07-13 UTC

Public URL: `https://tanaghom.38-247-187-232.sslip.io/`

## Outcome

The authenticated Tanaghom dashboard is publicly reachable through its own
Nginx virtual host and a trusted Let's Encrypt certificate. This deployment
advances Phase 7 but does not enable public n8n, webhook ingress, publishing, or
later-phase integrations.

Outside-in results:

- plain HTTP returned `308` to the canonical HTTPS URL;
- `/login` returned HTTP `200` over trusted TLS;
- unauthenticated `/` returned `307` to `/login?next=%2F`;
- unauthenticated `/api/operations` returned HTTP `401`;
- the public TCP 5678 probe failed (`HTTP 000`, connection timeout);
- the dashboard container remained bound to `127.0.0.1:3200`;
- the n8n editor remained bound to `127.0.0.1:5678`.

## Authentication and edge controls

- Dashboard runtime: `APP_ENV=production` and
  `APP_BASE_URL=https://tanaghom.38-247-187-232.sslip.io`.
- Production mode makes access and refresh cookies `Secure` in addition to
  their existing `HttpOnly` and SameSite settings.
- Nginx forwards the canonical host/protocol headers used by same-origin checks.
- Password-login throttling returned six bounded application responses and then
  HTTP `429` for the remaining rapid requests.
- Request bodies are limited to 1 MiB.
- HSTS, `nosniff`, frame denial, strict-origin referrer policy, and restrictive
  browser permission headers were present on public responses.
- The public virtual host contains no n8n, webhook, or TCP 5678 route.

## TLS and recovery

- Certificate SAN:
  `DNS:tanaghom.38-247-187-232.sslip.io`.
- Certificate expiry: 2026-10-11.
- Certbot installed its scheduled renewal task.
- `certbot renew --cert-name tanaghom.38-247-187-232.sslip.io --dry-run`
  succeeded.
- The first activation encountered the old certificate during Nginx's
  asynchronous reload. The transaction removed public ingress and restored the
  private dashboard automatically. A bounded certificate-readiness retry was
  added, and the second activation committed successfully.
- Exact rollback removes only the Tanaghom Nginx configuration/marker and
  recreates the dashboard from the private base Compose file. The certificate
  is preserved for audit and reuse.

## Protected-service gate

- Dashboard container: healthy.
- All five n8n containers: healthy.
- All nine protected SmartLabs systemd units: active.
- SmartLabs API, ConvAI, and SmartCC health endpoints: HTTP `200`.
- Nginx configuration test: passed.
- Root filesystem: 398 GiB total, 344 GiB used, 39 GiB available (90%).

Team members need an active Tanaghom/Supabase user account to pass the public
login page. No shared application password is stored in this package or GitHub.
