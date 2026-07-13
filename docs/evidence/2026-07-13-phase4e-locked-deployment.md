# Phase 4E locked production deployment evidence

Date: 2026-07-13 UTC

## Outcome

PR #38 and PR #40 were merged into `main`. Dashboard commit
`d85a6a3901d3a45a9c9d361a45d11880233df9f4` and database migrations
`0008_customer_integrations` and `0009_postiz_automation_controls` were deployed.

The deployment intentionally stopped before automation activation:

- organization Postiz mode: `manual`;
- platform emergency stop: active;
- `POSTIZ_AUTOMATION_RUNTIME_READY=false`;
- integration gateway URL: empty in the dashboard runtime;
- saved customer integration connections: zero;
- Postiz draft jobs: zero;
- Postiz external operations: zero; and
- no provider call or publishing action occurred.

## Recovery evidence

An encrypted off-server PostgreSQL backup covered both `public` and `tanaghom`
schemas, including the migration ledger. Its archive SHA-256 was
`7204c4e232f97bcbceced12c2763332d03968e7494c37633e508e6bbde44be38`.
Archive integrity and the PostgreSQL restore catalog were verified before the
migrations ran. The runtime encryption key and gateway token were backed up in
a separate encrypted archive with SHA-256
`6cd83d037b4eaa3bf62121fc19184071d55ed0202548e1b4f00a89d24d9bee69`.
Recovery keys are Windows DPAPI-protected and excluded from Git.

The previous dashboard image remains tagged as
`tanaghom-dashboard-canary:rollback-f5042c6d2840-phase4e`.

## Dashboard acceptance

- Deployed image:
  `sha256:18dcdcb0c81f9c0707565b40834b88edd8760adaad53b3d97198e09a34ed8abc`.
- Container and application health: healthy; API ready, authentication
  configured, and database connected.
- Public login: HTTP 200 over the existing trusted HTTPS virtual host.
- Unauthenticated root: HTTP 307 to login.
- Unauthenticated operations API: HTTP 401.
- Root filesystem before deployment: 36 GiB available.

The first long-running wrapper attempt was interrupted before mutation and the
next two transactional attempts restored the prior healthy dashboard because a
Compose exec health probe terminated the surrounding SSH command after printing
healthy JSON. The committed attempt used both Docker health state and the
loopback-only HTTP health endpoint. No partial dashboard revision remained.

## n8n workflow evidence

The existing Phase 4 workflow was backed up and reconciled with the merged
export. Its final state was:

- ID: `phase4PostizDraftV1`;
- active: false;
- polling schedule node: disabled;
- executions: zero; and
- operational definition SHA-256:
  `b07bf3c2041fd3edbd3e39b39742e8533ec8dfe48a6e352356af970877f1b3ec`.

The exact pre-update workflow backup is stored on the GPU server under the
package-owned `/var/backups/tanaghom-n8n` directory. n8n audit completed. It
reported the expected generic SQL query-parameter and reviewed Code/HTTP node
warnings; Execute Command, Read/Write Files, and SSH nodes remained excluded.

## Protected-service gate

All nine protected SmartLabs/voice-agent systemd units remained active. All five
n8n containers remained healthy. No SmartLabs configuration, production voice
agent file, Gemma service, Nginx virtual host, public n8n ingress, or webhook
ingress was changed.

The next infrastructure step is the separate Phase 4F private gateway package
in Issue #41. It remains undeployed pending explicit approval of its
Compose/firewall diff and rollback procedure.
