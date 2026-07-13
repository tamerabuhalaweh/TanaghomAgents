# Phase 4F restricted-proxy production deployment evidence

Date: 2026-07-13 UTC

## Outcome

Approved PR #43 was merged at commit
`6ba921969f50ec37e989123dd84c55122fce2d8a` and deployed to the GPU server.
The corrected design routes n8n gateway traffic through the existing
deny-by-default Squid proxy. The dashboard remains outside every SmartLabs and
Tanaghom n8n Docker network and retains only its outbound network.

The deployment changed only the `egress-proxy`, `n8n`, and `n8n-worker`
containers. It did not modify the dashboard container, Nginx, host firewall,
SmartLabs services, voice-agent files, Gemma service, database schema, workflow
activation, polling state, or publishing policy.

## Recovery and preflight

- The encrypted off-server Phase 4 database and integration-runtime archives
  matched their recorded SHA-256 hashes. Their DPAPI-protected recovery keys
  remain outside Git.
- Root filesystem availability was 36 GiB, above the 20 GiB deployment gate.
- All nine protected SmartLabs, voice-agent, Gemma, web, and Nginx units were
  active.
- All five n8n stack containers and the dashboard were healthy.
- The dashboard was bound to `127.0.0.1:3200` and attached only to
  `tanaghom-dashboard-outbound` at `172.30.251.2`.
- The merged Compose configuration and reviewed Squid configuration parsed
  successfully before container recreation.
- The existing gateway credential had the expected fixed ID, name, and n8n
  header-credential type. No plaintext credential was written to Git or output.

## Network and authentication validation

The real boundary validation ran independently from n8n main and n8n worker.
Both produced the same result:

- Squid CONNECT to `api.thesmartlabs.net:443`: HTTP 200.
- Squid CONNECT to `tanaghom.38-247-187-232.sslip.io:443`: HTTP 200.
- Squid CONNECT to unapproved `example.com:443`: HTTP 403.
- Direct connection to `38.247.187.232:443`: denied.
- Direct connection to `10.0.0.1:5432`: denied.
- Direct connection to `1.1.1.1:443`: denied.
- Real TLS and hostname validation to the Tanaghom gateway: passed.
- Gateway request without authentication: HTTP 401.
- Gateway request with the worker credential but an invalid request body:
  HTTP 400.

The dashboard shared no n8n network after deployment. This removes the reverse
route that invalidated the earlier shared-bridge design.

## n8n and application safety state

- `phase4PostizDraftV1` active state: false.
- `Polling Disabled Pending Approval` node disabled state: true.
- Phase 4 workflow execution count: zero.
- `POSTIZ_AUTOMATION_RUNTIME_READY`: false.
- Platform Postiz emergency stop: true.
- Customer Postiz connections: zero.
- Postiz draft jobs: zero.
- Postiz external operations: zero.
- Gateway plaintext credential staging file: absent.
- Public login: HTTP 200.
- Unauthenticated operations API: HTTP 401.

The production n8n audit was saved under the package-owned
`/var/backups/tanaghom-n8n` directory. Its reviewed findings were the expected
inactive-credential, SQL query-parameter, HTTP Request, and Code-node warnings.
Execute Command, Read/Write Files, and SSH node types remained excluded and were
absent from all stored workflows.

## Protected-service result

All nine protected host services remained active, all five n8n containers were
healthy, and the dashboard remained healthy after deployment. No Postiz API
call, draft creation, external publishing action, or automatic polling occurred.

## Remaining Phase 4 gate

Phase 4 is not complete until a customer owner saves a dedicated Postiz
credential through Tanaghom, maps one staging channel, and authorizes one
controlled approved-content-to-Postiz-draft acceptance test. Automatic polling,
runtime readiness, emergency-stop release, performance synchronization, and
publishing remain outside this deployment.
