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
- PostgreSQL uses full TLS verification against the project pooler's Supabase
  Root 2021 CA. The pinned root certificate SHA-256 fingerprint is
  `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
  The certificate chain and fingerprint were independently matched from the
  developer workstation and GPU server; rotation is required before its 2031
  expiry or when Supabase rotates the project certificate.

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

Create seven files with `umask 077`: `database_url`, `supabase_url`,
`supabase_publishable_key`, `supabase_jwks_url`, `supabase_secret_key`,
`integration_credential_key`, and `integration_worker_token`.
The secret key is server-only and exists solely for owner-triggered Supabase
Auth invitations; it is never sent to the dashboard browser. The file may be
empty for a deployment where invitations are intentionally disabled.
`integration_credential_key` is a base64-encoded 32-byte random key used for
AES-256-GCM envelope encryption. `integration_worker_token` is an independent
random value of at least 32 characters used only by the restricted internal
workflow gateway. Generate both on the server, keep them out of shell history,
and back them up in the encrypted off-server recovery package. Losing the
encryption key makes saved customer credentials unrecoverable; rotation must
use the versioned application procedure before replacing the file.
`POSTIZ_AUTOMATION_RUNTIME_READY` remains `false` and the database platform
emergency stop remains enabled in this package. Do not change either gate until
the restricted n8n-to-dashboard network path, platform gateway credential,
inactive workflow import, and rollback have passed controlled validation. The
customer Admin mode cannot override the platform emergency stop.
Copy values from the existing ignored developer `.env` through an encrypted
channel without printing them. Do not use shell history, Compose environment
values, or Git for secret transfer. The transactional installer changes only
these files to `root:1000` mode `0640` before container startup; Compose file
secrets preserve host ownership when mounted outside Swarm.

## Validate and deploy

```bash
cd /opt/tanaghom-dashboard/deployment/dashboard-canary
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml config --quiet
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml build --pull dashboard
docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}'
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml up -d dashboard
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml ps
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml exec -T dashboard \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Recheck every protected unit and its existing HTTP health endpoints. Deployment
passes only when the dashboard is healthy and all protected services remain in
their baseline state. Record the checked-out Git commit and image ID together in
the deployment evidence so the locally built image remains traceable.

## Private access

Keep this tunnel open:

```powershell
ssh -L 3200:172.30.251.2:3000 administrator@38.247.187.232
```

Then open `http://127.0.0.1:3200`. The tunnel targets the package-owned fixed
container address because Docker userland proxying is disabled on this server.
The SSH tunnel is encrypted; the canary is not reachable from the public internet.

## Rollback

```bash
sudo /opt/tanaghom-dashboard/deployment/dashboard-canary/scripts/rollback.sh
```

Rollback removes only the dashboard container. It preserves the package-owned
network, image, source, and secret files for evidence. After review, removal of
those artifacts must name each `tanaghom-dashboard-canary` resource explicitly;
never use Docker prune or an unscoped Compose `down` command on this host.
