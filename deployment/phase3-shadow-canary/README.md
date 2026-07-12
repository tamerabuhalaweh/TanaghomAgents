# Phase 3 shadow canary

This secret-free package gives only the inactive Phase 3 n8n workflows a
verified-TLS path to the Supabase session pooler and the existing allowlisted
HTTPS path to Gemma. It does not enable schedules, webhooks, Postiz,
GoHighLevel, lead contact, publishing, or spending.

The database bridge is `172.30.252.0/29`. Only the fixed n8n main and worker
addresses may open TCP 5432 to the pooler's currently resolved public IPv4
addresses. A package chain is attached before the existing SmartLabs n8n chain
in `DOCKER-USER`, and a second package chain blocks database-bridge hairpin
access in host `INPUT`; all other traffic from the bridge is dropped.

Credentials are never committed. The database runtime login is a member only
of `tanaghom_n8n_worker`. n8n imports plaintext through a short-lived mode-600
file, encrypts it with the existing instance key, and removes staging files.
The Gemma key rotation script rolls back automatically if the model health gate
does not recover.

SSRF protection remains enabled. Its hostname exception contains exactly
`api.thesmartlabs.net`; Squid and the host firewall independently restrict that
name to the approved HTTPS Gemma path and prevent direct host/private access.

## Controlled order

1. Validate the merged Compose model and confirm `172.30.252.0/29` is unused.
2. Copy the override, CA, scripts, and SQL into `/opt/n8n-smartlabs`.
3. Create the database network only; install the transactional firewall next.
4. Recreate only n8n main and worker with both Compose files.
5. Validate allowed pooler TCP 5432 and denied destinations.
6. Create the dedicated runtime login and validate full TLS plus privileges.
7. Rotate Gemma's exposed token, health-check it, then import both credentials.
8. Re-import both workflows inactive and run `n8n audit`.
9. Seed one uniquely named zero-budget `.test` campaign. Execute Strategist
   manually, queue Content Producer only after strategy persistence, then
   execute it manually.
10. Verify the campaign stops at `awaiting_approval`, every draft is
    `pending_approval`, and no human approval or unrelated job exists.

Rollback removes the package firewall hook and chain, recreates n8n main and
worker without the override, and removes the unused database bridge. Workflow
activation is never part of this package.
