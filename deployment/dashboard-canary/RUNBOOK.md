# Tanaghom dashboard private canary

## Boundary

- Source: approved `main` commit from the public GitHub recovery source.
- Directory: `/opt/tanaghom-dashboard`.
- Compose project: `tanaghom-dashboard-canary`.
- One CPU-only container; ceiling `0.75` CPU, `768 MiB` RAM, `200` PIDs.
- Only binding: `127.0.0.1:3200`; no Nginx, DNS, TLS, or public ingress change.
- Read-only root filesystem, tmpfs `/tmp`, all Linux capabilities dropped, and
  `no-new-privileges` enabled.
- It does not join or modify any SmartLabs or n8n network.
- Required outbound destinations are the Supabase project HTTPS endpoint and
  shared PostgreSQL pooler. This initial private canary does not claim a strict
  network-level egress allowlist; public deployment requires that additional
  control and a renewed review.

## Mandatory preflight

```bash
date -u
df -h /
free -h
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 20
! ss -ltn | awk '{print $4}' | grep -Eq '(^|:)3200$'
systemctl is-active \
  smartlabs-api.service convai-ws.service convai-stt-api.service \
  omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service \
  smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker network inspect tanaghom-dashboard-outbound >/dev/null 2>&1 && exit 1 || true
```

Stop if any protected service is unhealthy, free disk is below 20 GiB, port
3200 is occupied, or subnet `172.30.251.0/29` overlaps an existing route or
Docker network.

## Install source and secrets

```bash
sudo install -d -m 0755 /opt/tanaghom-dashboard
sudo chown administrator:administrator /opt/tanaghom-dashboard
git clone https://github.com/tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-dashboard
cd /opt/tanaghom-dashboard
git checkout <APPROVED_MAIN_COMMIT>
install -d -m 0700 deployment/dashboard-canary/secrets
```

Create the four files documented in `secrets/README.md` with `umask 077`.
Copy values from the existing ignored developer `.env` through an encrypted
channel without printing them. Do not use shell history, Compose environment
values, or Git for secret transfer.

## Validate and deploy

```bash
cd /opt/tanaghom-dashboard/deployment/dashboard-canary
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml config --quiet
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml build --pull dashboard
docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}'
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml up -d dashboard
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml ps
curl -fsS http://127.0.0.1:3200/api/health
```

Recheck every protected unit and its existing HTTP health endpoints. Deployment
passes only when the dashboard is healthy and all protected services remain in
their baseline state. Record the checked-out Git commit and image ID together in
the deployment evidence so the locally built image remains traceable.

## Private access

Keep this tunnel open:

```powershell
ssh -L 3200:127.0.0.1:3200 administrator@38.247.187.232
```

Then open `http://127.0.0.1:3200`. The SSH tunnel is encrypted; the canary is
not reachable from the public internet.

## Rollback

```bash
sudo /opt/tanaghom-dashboard/deployment/dashboard-canary/scripts/rollback.sh
```

Rollback removes only the dashboard container. It preserves the package-owned
network, image, source, and secret files for evidence. After review, removal of
those artifacts must name each `tanaghom-dashboard-canary` resource explicitly;
never use Docker prune or an unscoped Compose `down` command on this host.
