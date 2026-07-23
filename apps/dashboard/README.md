# Tanaghom dashboard

The human-facing Agent Operations Dashboard. It is a Next.js application and
does not expose the n8n editor.

```bash
npm install
npm run dev:dashboard
```

Current Phase 2 screens use authenticated server-side adapters for approvals,
audit history, campaigns, agent jobs, leads, reporting, notifications, and
system health. Configured agent-role definitions remain static until their live
Phase 3-5 workflows are activated.

## Server API foundation

The initial server-only API exposes:

- `GET /api/health` with truthful configuration/connectivity state;
- `GET /api/approvals` for authenticated active application users;
- `GET /api/audit` for authenticated active application users.
- `GET /api/operations` for a consistent read-only snapshot used by overview,
  campaign, agent, lead, report, notification, and health surfaces. Its
  `skill_registry` field lists tenant-visible published skill versions,
  server-enforced permission manifests, checksums, and pinned worker bindings;
  it never exposes provider credentials or grants runtime authority.
- `GET /api/quality` for the authenticated quality evidence and controlled
  rollout snapshot; `PUT /api/quality` records sequential owner decisions only.
- `POST /api/approvals/:id/decision` for owner/reviewer decisions with an
  `Idempotency-Key` header.

Protected routes require a Supabase access token in the `Authorization: Bearer`
header or the HttpOnly session cookie issued by `/api/auth/login`. JWT signatures,
issuer, and audience are verified against the configured project JWKS. The token
subject must map to `tanaghom.app_users.auth_subject`. Next.js Proxy performs only
an optimistic page redirect; every data route still verifies the token and role.
Database credentials and Supabase secret keys are never sent to browser code.

Approval decisions write the human approval, protected content transition, correlated
audit entry, durable outbox event, and replayable response in one transaction.
They do not call n8n or an external service.
