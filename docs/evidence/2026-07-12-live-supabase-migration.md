# Live Supabase foundation migration evidence

- Date: 2026-07-12
- Project reference: `gvyldxhhynusmnrllxjj`
- Database: PostgreSQL 17.6 through the Shared Pooler session endpoint
- Scope: migrations `0001_shared_foundation`, `0002_auth_subjects`, and
  `0003_api_idempotency`

## Preflight

The initial catalog inspection ran inside an explicit read-only transaction.
It found 12 legacy `public` tables, four views, no `tanaghom` schema, and no
migration ledger. Estimated legacy row counts were:

| Object | Rows |
| --- | ---: |
| `public.campaigns` | 1 |
| `public.channel_integrations` | 4 |
| `public.message_templates` | 6 |
| all other legacy public tables | 0 |

## Recovery point

A schema-and-data custom dump of `public` was created off the Supabase server,
encrypted with 7-Zip header encryption, and tested before migration. Its random
recovery key is protected by Windows DPAPI for the current operator account.
No plaintext dump remains.

- Local recovery directory:
  `C:\Users\tamer\Desktop\Groky\backups\supabase-pre-tanaghom-20260712T144808Z`
- Encrypted archive SHA-256:
  `5d2b7099144f885a14e3f5a068881b34284f8f657e7f9971f73f9d271454d259`
- Encrypted archive test: passed
- DPAPI key recovery test: passed

The backup and recovery key are intentionally excluded from GitHub.

## Applied result

All three migrations committed successfully. Post-migration read-only evidence
confirmed:

- ledger versions `0001`, `0002`, and `0003` are present;
- 16 authoritative base tables exist under `tanaghom`;
- 17 `tanaghom` safety triggers exist;
- the unique human `auth_subject` index exists;
- the API idempotency table exists;
- all legacy `public` row counts remained unchanged.

No legacy table or view was altered or removed. No seed, workflow, external API,
or production side effect was executed.

## Initial owner identity

The first Supabase Auth UID/email pair was verified against `auth.users` and
linked to an active human `tanaghom.app_users` record with the `owner` role. The
bootstrap operation created one correlated immutable audit entry. The email and
authentication subject are intentionally excluded from committed evidence.

## Idempotency verification

PostgreSQL 17 and Windows line endings exposed two migration-runner assumptions:
Boolean catalog output may be `true` or `t`, and version output may use CRLF.
The runner was corrected to accept both Boolean forms and normalize each version
line. A subsequent live `npm run db:migrate` cleanly reported all three versions
as already applied and performed no write.
