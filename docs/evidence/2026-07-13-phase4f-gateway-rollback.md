# Phase 4F gateway attempt and rollback evidence

Date: 2026-07-13 UTC

## Result

The first Phase 4F private-bridge design from PR #42 was deployed under its
transactional runbook and then fully rolled back after a real reverse-path test
found that the dashboard container at `172.30.252.4` could connect to n8n main at
`172.30.252.2:5678` on the shared user-defined Docker bridge.

The package's `DOCKER-USER` chain correctly constrained routed egress, but the
server's same-bridge container forwarding path did not enforce the assumed
reverse isolation. Earlier negative probes targeted unused dashboard ports and
returned connection refused; those probes did not prove the reverse direction.
The added live socket test correctly failed the deployment gate.

## Rollback

The approved rollback procedure completed:

- n8n main and worker were recreated without the Phase 4 gateway environment;
- the original `TANAGHOM_N8N_DB_EGRESS` hook was restored;
- `TANAGHOM_N8N_GATEWAY_EGRESS` was removed;
- the dashboard was recreated without the n8n database-egress network;
- the dashboard retained only `tanaghom-dashboard-outbound=172.30.251.2`;
- public dashboard login remained HTTP 200 over HTTPS;
- all five n8n containers returned healthy; and
- all nine protected SmartLabs/voice-agent systemd units remained active.

The imported `Tanaghom Integration Gateway` credential remains encrypted and
unused in n8n. No workflow was activated, the schedule remained disabled,
runtime readiness remained false, the database emergency stop remained active,
and no Postiz credential, job, external operation, or provider call occurred.

The pre-change firewall snapshot and n8n audit are stored in the package-owned
`/var/backups/tanaghom-phase4f-20260713T090253Z` directory on the GPU server.

## Corrective design

The corrected package keeps the dashboard off every n8n network. n8n connects
through the existing Squid egress proxy to Tanaghom's exact public HTTPS
hostname. Squid retains deny-all behavior for other domains and the existing
host firewall already permits only the proxy container to the host on TCP/443.
The revised validation performs actual proxy CONNECT, TLS, gateway 401/400,
direct-egress denial, and dashboard network-isolation checks against both n8n
execution containers.

The corrected package requires a new reviewed PR and explicit approval before
another production deployment attempt.
