# Tanaghom public dashboard canary

Public hostname: `tanaghom.38-247-187-232.sslip.io`.

This package publishes only the authenticated dashboard through Nginx. The
dashboard container remains bound to `127.0.0.1:3200`; n8n remains bound to
`127.0.0.1:5678`; no webhook route is exposed. The production override enables
Secure session cookies and the public application origin.

Nginx redirects HTTP to HTTPS, terminates a Let's Encrypt certificate, forwards
the canonical host/protocol headers, rate-limits password login, limits request
bodies, and adds transport/browser security headers. ACME renewal continues
through the dedicated webroot.

## Deploy

From the approved GitHub commit on the server:

```sh
cd /opt/tanaghom-dashboard
sudo TANAGHOM_PUBLIC_DEPLOY_AUTHORIZED=YES-I-AM-THE-AUTHORIZED-OWNER \
  LETSENCRYPT_EMAIL='<operator email>' \
  ./deployment/dashboard-public/scripts/deploy.sh
```

## Validate

```sh
curl -I http://tanaghom.38-247-187-232.sslip.io/
curl -I https://tanaghom.38-247-187-232.sslip.io/login
curl -i https://tanaghom.38-247-187-232.sslip.io/api/operations
sudo certbot renew --dry-run
```

Expected: HTTP redirects to HTTPS, login returns 200, the protected API returns
401 without a session, and renewal simulation succeeds. Validate a real owner
login without printing credentials, confirm Secure/HttpOnly/SameSite cookie
attributes, and recheck all protected SmartLabs/n8n services.

## Exact rollback

```sh
sudo /opt/tanaghom-dashboard/deployment/dashboard-public/scripts/rollback.sh
```

Rollback removes only the Tanaghom public Nginx configuration and deployment
marker, reloads Nginx, and recreates the dashboard from the private base Compose
file. It preserves the certificate for audit/possible reuse and does not touch
SmartLabs domains, n8n, database data, or dashboard secrets.
