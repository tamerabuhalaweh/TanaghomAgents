# Tanaghom dashboard private canary deployment — 2026-07-12

## Result

The Phase 2 dashboard is deployed as a healthy, SSH-only canary on the GPU
server. The deployed Git recovery source is commit
`ec07948eeeed9bf8f9cd68ced2103da4f2ae9ba2`; the locally built image ID is
`sha256:77efaf9e3c9037f8d7ae515bb44568a2869794fcf30010470b7112297eaf31dd`.

No Nginx, DNS, public ingress, n8n, Gemma, voice-agent, or protected SmartLabs
service configuration was changed.

## Runtime evidence

- Container: `tanaghom-dashboard-canary-dashboard-1` — healthy with zero
  failing health checks.
- Application health returned API `ready`, authentication `configured`, and
  database `connected`.
- Login returned HTTP 200.
- An unauthenticated root request redirected to login.
- An unauthenticated operations request returned HTTP 401.
- A connection to the server's public address on port 3200 failed as intended.
- Container address: `172.30.251.2`; review access is through an encrypted SSH
  tunnel only.
- Observed memory after startup: 42.97 MiB of the 768 MiB limit; 11 PIDs.
- Enforced limits: 0.75 CPU, 768 MiB RAM, 200 PIDs, read-only root filesystem,
  all capabilities dropped, and `no-new-privileges` enabled.
- Host filesystem after deployment: 398 GiB total, 342 GiB used, 40 GiB
  available.

## TLS evidence

The Supabase pooler presented a private chain rooted in Supabase Root 2021 CA.
The initial container correctly rejected that chain because its root was not in
Node's public trust store. The final package pins the project pooler's public
root CA and retains full certificate/hostname verification; it does not disable
TLS validation.

The complete leaf, intermediate, and root SHA-256 fingerprints matched from two
independent network paths: the developer workstation and GPU server. The pinned
root fingerprint is:

`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

## Protected service verification

All nine protected systemd units remained active. SmartLabs API, ConvAI, and
SmartCC HTTP health checks returned success. The five-container n8n stack also
remained healthy.

## Corrections made during controlled deployment

1. Compose file secrets preserved root-only host ownership, so the non-root
   Node process could not read them. The package now uses `root:1000`, mode
   `0640`, matching the proven n8n secret-mount pattern.
2. PowerShell-to-SSH text staging appended a carriage-return byte. The transport
   byte was removed without printing or changing secret values.
3. Node rejected the Supabase private CA chain. The verified Supabase root CA
   was pinned instead of weakening TLS.

The first installer removed its failed container automatically. No failed
container was left running.

## Access and rollback

Private review tunnel:

```powershell
ssh -L 3200:172.30.251.2:3000 administrator@38.247.187.232
```

Open `http://127.0.0.1:3200` while that session remains connected.

Scoped rollback:

```bash
sudo /opt/tanaghom-dashboard/deployment/dashboard-canary/scripts/rollback.sh
```

Public HTTPS delivery remains a separate Phase 7 gate requiring a selected
domain/subdomain, TLS, restricted ingress/egress, monitoring, and recovery
review.
