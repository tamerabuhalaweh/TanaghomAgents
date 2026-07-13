# Phase 4 Postiz gateway activation

This package routes n8n to the Tanaghom gateway through the existing authenticated
egress architecture: n8n connects to Squid, Squid permits CONNECT only to the
exact Tanaghom HTTPS hostname, and Nginx forwards the request to the loopback-only
dashboard. The dashboard never joins an n8n network and therefore has no reverse
route to n8n.

The package does not publish content, make a Postiz provider call, enable the
workflow schedule, set runtime readiness, or clear the database emergency stop.

## Required order

1. Confirm the approved commit, encrypted backups, at least 20 GiB free, nine
   protected systemd units active, and five n8n containers healthy.
2. Confirm the dashboard has only `tanaghom-dashboard-outbound` and remains bound
   to `127.0.0.1:3200`.
3. Pull the pinned validation image.
4. Parse the base, Phase 3, and Phase 4 Compose files together.
5. Recreate only `egress-proxy`, `n8n`, and `n8n-worker`. The Phase 4 override
   mounts the reviewed Squid configuration, adds the exact Tanaghom SSRF hostname,
   and uses `https://tanaghom.38-247-187-232.sslip.io` as the gateway URL.
6. Confirm `squid -k parse`, proxy health, and both n8n execution containers.
7. If the gateway credential is absent, pipe the server-side worker token to
   `scripts/import-gateway-credential.sh`. It imports through the n8n CLI and
   removes all plaintext staging files. If the credential already exists, verify
   its ID/name/type and do not overwrite it.
8. Pipe the worker token to `scripts/validate-gateway-boundary.sh`. It verifies
   exact-hostname CONNECT, TLS, 401/400 authentication behavior, direct egress
   denial, and that the dashboard shares no n8n network.
9. Run `n8n audit`; verify `phase4PostizDraftV1` remains inactive, its schedule
   remains disabled, and its execution count remains zero.
10. Recheck dashboard HTTPS, all protected units/containers, disk, runtime false,
    and the active database emergency stop.

## Controlled preparation commands

```sh
sudo docker pull node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

cd /opt/n8n-smartlabs
sudo docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  -f /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/docker-compose.n8n-gateway.yml \
  config --quiet
sudo docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  -f /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/docker-compose.n8n-gateway.yml \
  up -d --no-deps egress-proxy n8n n8n-worker

sudo docker exec smartlabs-n8n-egress-proxy-1 squid -k parse

sudo sh -c 'cat /opt/tanaghom-dashboard/deployment/dashboard-canary/secrets/integration_worker_token |
  /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/scripts/import-gateway-credential.sh'

sudo sh -c 'cat /opt/tanaghom-dashboard/deployment/dashboard-canary/secrets/integration_worker_token |
  /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/scripts/validate-gateway-boundary.sh'

sudo docker exec --user node smartlabs-n8n-n8n-1 n8n audit
```

## Exact rollback

The rollback removes only the Phase 4 Compose override. No firewall update or
dashboard network attachment exists in this corrected design.

```sh
cd /opt/n8n-smartlabs
sudo docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  up -d --no-deps egress-proxy n8n n8n-worker
```

After rollback, verify the original Squid configuration permits only Gemma, the
gateway URL is absent from n8n main/worker, the dashboard has no n8n network, all
five n8n containers are healthy, and public dashboard authentication still works.
The encrypted gateway credential may remain as unused recovery evidence.

## Final activation gate

Only after a customer owner saves a Postiz credential, maps a staging channel,
and passes one manually executed draft test may a separate approved change enable
the schedule, set runtime readiness true, and clear the emergency stop. Public
publishing remains unavailable.
