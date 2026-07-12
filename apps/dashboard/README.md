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
