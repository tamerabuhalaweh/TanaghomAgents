# Groky legacy v0 snapshot

This directory preserves the secret-free implementation discovered in the
original local `Groky` workspace during the Phase 2 reconciliation audit.

It is reference and recovery material, not deployable Tanaghom source:

- SQL targets unqualified `public` tables and is incompatible with the
  authoritative `tanaghom` schema.
- n8n exports are inactive, use placeholder credential IDs, and have not passed
  end-to-end acceptance.
- The Express dashboard demonstrates useful operational behavior but uses a
  shared Basic Auth identity and direct SQL writes that bypass the Phase 1
  application boundary.
- `ALL_for_supabase_sql_editor.sql` and `005_repair_idempotent.sql` are retained
  only to explain the historical database; neither may be run as a migration.

No `.env`, credentials, n8n runtime data, customer data, or `node_modules` are
included. New work belongs in `apps`, `services`, `packages`, and `n8n`.

See `docs/reconciliation/GROKY_V0_AUDIT.md` for the compatibility decisions and
the supervised reimplementation plan.
