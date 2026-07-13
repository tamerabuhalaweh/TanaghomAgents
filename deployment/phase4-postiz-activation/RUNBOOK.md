# Phase 4 Postiz gateway activation

This package prepares the private n8n-to-dashboard gateway. It does not publish
content and it does not make a Postiz provider call. The source workflow remains
inactive and its polling trigger remains disabled until a separate final gate.

## Required order

1. Confirm the approved commit, encrypted database/runtime backups, at least 20
   GiB free, nine protected systemd units active, and five n8n containers healthy.
2. Pull the pinned validation image before changing Compose or firewall state.
3. Recreate only the dashboard with the base, public, and dashboard-gateway
   Compose files. Confirm it is healthy on both networks at `172.30.251.2` and
   `172.30.252.4`.
4. Apply `update-gateway-firewall.sh` with the explicit authorization variable.
   The script builds and validates the replacement chain before attaching it,
   attaches it before removing the old hook, and restores the old hook on error.
5. Recreate only n8n main and worker with the base n8n Compose, Phase 3 database
   egress override, and `docker-compose.n8n-gateway.yml`.
6. Pipe the existing server-side worker token to
   `scripts/import-gateway-credential.sh`. It imports the
   `Tanaghom Integration Gateway` header credential through the n8n CLI and
   removes every plaintext staging file. Never place the token in Git, a Compose
   environment value, command argument, workflow JSON, or log.
7. Pipe the worker token to `validate-gateway-boundary.sh`. Both n8n execution
   containers must reach only Supabase TCP/5432 and the dashboard gateway
   TCP/3000; unauthorized gateway HTTP must return 401 and an authenticated
   invalid request must return 400 without touching Postiz.
8. Run `n8n audit`, verify `phase4PostizDraftV1` is inactive, its schedule node is
   disabled, and its execution count remains zero.
9. Recheck public dashboard authentication, all protected units/containers, disk,
   and firewall hooks. Stop here until a customer connects and tests Postiz.

## Controlled preparation commands

Run only from the approved commit after the preflight above:

```sh
sudo docker pull node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

cd /opt/tanaghom-dashboard
sudo docker compose -p tanaghom-dashboard-canary \
  -f deployment/dashboard-canary/docker-compose.yml \
  -f deployment/dashboard-public/docker-compose.yml \
  -f deployment/phase4-postiz-activation/docker-compose.dashboard-gateway.yml \
  up -d --no-deps dashboard

sudo TANAGHOM_FIREWALL_CHANGE_AUTHORIZED=YES-I-AM-THE-AUTHORIZED-OWNER \
  ./deployment/phase4-postiz-activation/scripts/update-gateway-firewall.sh

cd /opt/n8n-smartlabs
sudo docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  -f /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/docker-compose.n8n-gateway.yml \
  up -d --no-deps n8n n8n-worker

sudo sh -c 'cat /opt/tanaghom-dashboard/deployment/dashboard-canary/secrets/integration_worker_token |
  /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/scripts/import-gateway-credential.sh'

sudo sh -c 'cat /opt/tanaghom-dashboard/deployment/dashboard-canary/secrets/integration_worker_token |
  /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/scripts/validate-gateway-boundary.sh'

sudo docker exec --user node smartlabs-n8n-n8n-1 n8n audit
```

These commands do not change `POSTIZ_AUTOMATION_RUNTIME_READY=false`, do not
clear the database emergency stop, do not enable the schedule node, and do not
publish the workflow.

## Final activation gate

Only after a customer owner saves a Postiz credential, maps a staging channel,
and passes a manual draft test may the platform operator prepare a separate
activation diff that enables the schedule node, sets dashboard runtime readiness
to true, and clears the database emergency stop. Public publishing remains out
of scope. A failed or indeterminate provider request must stop further work.

## Exact rollback order

1. Set the database platform emergency stop to true and organization mode to
   `paused` if either was changed.
2. Deactivate the Phase 4 workflow. Re-import the recorded inactive backup if its
   definition changed.
3. Recreate n8n main and worker using only the base and Phase 3 Compose files.
4. Run `rollback-gateway-firewall.sh` with the authorization variable.
5. Recreate the dashboard using only the base and public Compose files.
6. Preserve the encrypted, now-unused `Tanaghom Integration Gateway` credential
   for rollback evidence. It can be deleted later through the n8n credential UI
   after the incident/recovery review; no supported CLI deletion command exists
   in the pinned n8n release.
7. Verify the old firewall hook, all protected services, dashboard HTTPS, and the
   five-container n8n stack.

Exact infrastructure rollback commands:

```sh
cd /opt/n8n-smartlabs
sudo docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  up -d --no-deps n8n n8n-worker

sudo TANAGHOM_FIREWALL_CHANGE_AUTHORIZED=YES-I-AM-THE-AUTHORIZED-OWNER \
  /opt/tanaghom-dashboard/deployment/phase4-postiz-activation/scripts/rollback-gateway-firewall.sh

cd /opt/tanaghom-dashboard
sudo docker compose -p tanaghom-dashboard-canary \
  -f deployment/dashboard-canary/docker-compose.yml \
  -f deployment/dashboard-public/docker-compose.yml \
  up -d --no-deps dashboard
```

The rollback does not remove customer records, approval evidence, encrypted
integration rows, execution history, SmartLabs resources, or voice-agent files.
