# Tanaghom dashboard

The human-facing Agent Operations Dashboard. It is a Next.js application and
does not expose the n8n editor.

```bash
npm install
npm run dev:dashboard
```

Current Phase 2 screens use safe fixture data while application authentication
and database access are introduced behind explicit server-side adapters. No
fixture button performs an external action.

## Server API foundation

The initial server-only API exposes:

- `GET /api/health` with truthful configuration/connectivity state;
- `GET /api/approvals` for authenticated active application users;
- `GET /api/audit` for authenticated active application users.

Protected routes require a Supabase access token in the `Authorization: Bearer`
header. JWT signatures, issuer, and audience are verified against the configured
project JWKS. The token subject must map to `tanaghom.app_users.auth_subject`.
Database credentials and Supabase secret keys are never sent to browser code.

These endpoints are intentionally not connected to the fixture UI yet. Approval
mutations remain disabled until authenticated transaction, idempotency, conflict,
and recovery tests are complete.
