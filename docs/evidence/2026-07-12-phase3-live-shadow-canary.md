# Phase 3 live shadow-canary evidence

Date: 2026-07-12 UTC

## Outcome

The controlled Phase 3 live gate passed on the GPU server. One uniquely named
`.test` campaign completed brief → persisted strategy → two content drafts and
stopped at the human approval boundary. Neither workflow was activated.

Final database evidence for campaign
`tanaghom-phase3-shadow-20260712.test`:

- campaign ID: `a2829ec3-a2fc-4bab-b0fc-ea624765af60`
- status: `awaiting_approval`
- budget target: `0.00`
- revenue target: `0.00`
- persisted strategies: `1`
- content items: `2`
- content items in `pending_approval`: `2`
- human approvals: `0`
- posts: `0`
- leads: `0`
- external operations: `0`
- Strategist job: `succeeded`
- Content Producer job: `waiting_approval`

## Network and credentials

- n8n main and worker were attached to the dedicated
  `172.30.252.0/29` database-egress bridge at fixed addresses.
- Transactional package-owned `DOCKER-USER` and `INPUT` chains allow only the
  Supabase session pooler's resolved public IPv4 addresses on TCP 5432 and
  block direct host/private/public bypasses.
- The socket proof succeeded for the pooler and failed for pooler TCP 443,
  public TCP 443, RFC1918 TCP 5432, SmartLabs TCP 443, and SmartLabs TCP 8026.
- The dedicated `tanaghom_n8n_runtime` login is a member only of
  `tanaghom_n8n_worker`. Verified TLS succeeded; controlled function execution
  was present; all approval-table privileges were absent.
- The exposed Gemma token was rotated without disclosure. The model recovered,
  the old unit backup was removed, and the authenticated Squid route returned
  HTTP 200 with the new token.
- n8n imported the PostgreSQL and header credentials under their stable IDs,
  encrypted them with the existing instance key, and removed plaintext staging
  files. The standalone database password file was deleted after validation.

## Runtime corrections proven by real tests

The live gate found and corrected four issues before acceptance:

1. The initial disposable socket probe lacked stdin attachment. After fixing
   it, the real test exposed database-bridge access to the host's public HTTPS
   listener. A package-owned host `INPUT` chain now blocks that hairpin path.
2. n8n SSRF protection correctly blocked the first Gemma attempt. Protection
   remains enabled; its only exceptions are `api.thesmartlabs.net` and the
   internal `egress-proxy` transport. Squid and firewall validation still deny
   all unapproved destinations.
3. vLLM rejected unsupported JSON Schema annotations. The workflow generator
   now removes only guided-decoder-unsupported annotations while the committed
   schemas, parser, and database functions retain the business contract checks.
4. A non-regeneration content job included JSON `null` for an optional field.
   The v1 job contract/operator now omit that field unless regeneration is
   actually requested. The failed function transaction wrote no drafts before
   the corrected retry.

Every failed attempt was bounded to the `.test` campaign and produced no
external side effect. The final manual executions used the restricted live
credentials and real Gemma endpoint.

## Final operational validation

- Both Phase 3 workflows: `active=false`, nine nodes each.
- n8n audit completed with Credentials, Database, Instance, and Nodes reports.
- All five n8n containers were healthy.
- All nine protected SmartLabs systemd units were active.
- SmartLabs API, ConvAI, SmartCC API, and Tanaghom dashboard health gates
  returned HTTP 200.
- Authenticated Gemma access through Squid succeeded; unapproved public,
  private, direct-bypass, and protected-port probes failed.
- Root filesystem: 398 GiB total, 343 GiB used, 39 GiB available (90%).

Scheduled polling, external webhooks, Postiz, GoHighLevel, publishing, lead
contact, and spending remain disabled. The two drafts intentionally remain for
an authenticated human to review in Tanaghom.
