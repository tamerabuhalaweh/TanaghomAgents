# Creative Runtime — Repository Reconciliation (docs-only)

**Branch:** `plan/creative-runtime-reconciliation`
**Base:** `origin/main` at `b3e8619` (Merge PR #211)
**Date:** 2026-10-07
**Scope:** RECONCILIATION ONLY — documentation, no feature code
**Status:** DRAFT FOR REVIEW — not a build authorization

## Explicit non-goals of this PR

- No model deployment, no GPU provisioning, no public exposure of internal services.
- No production modification, no production credentials, no `.env` values.
- No n8n workflow activation (all 16 committed exports stay `active:false`).
- No Postiz calls, no GHL calls, no customer/provider state changes.
- No changes to SmartLabs, SmartCC, voice infra, Gemma infrastructure.
- No changes to `archive/legacy-v0` beyond its reference-only role.
- No new runtime tables, no migration, no API behavior change.

Rollback: delete this branch / revert this docs-only commit. No runtime effect.

---

## 0. Onboarding record (mandatory files)

Read completely, in order, at this branch base:

1. `docs/STATUS.md` — READ (200 lines, 2026-09-06 workspace/test-VPS state, 60/100 NO-GO).
2. `docs/PROJECT_CONTEXT.md` — READ (135 lines, repo boundary, `apps/dashboard`, `packages/*`, `archive/legacy-v0` not deployable).
3. `docs/PRODUCTION_READINESS.md` — READ (76 lines, 20-gate v1 scorecard, 60/60 source + 0/40 runtime).
4. `docs/DEFINITION_OF_DONE.md` — READ (37 lines, UI/API demo + versioned reversible DB + idempotent writes + audit + tests + rollback).
5. `docs/planning/creative-platform/AGENT_COORDINATION.md` — **MISSING**.
6. `docs/planning/creative-platform/MASTER_PLAN.md` — **MISSING**.
7. `docs/planning/creative-platform/MUSE_REPO_RECONCILIATION.md` — **MISSING**.

Proof at base (no creative-platform docs on either ref):

- `git ls-tree -r --name-only origin/main -- docs/planning/` contains `agency-expansion/*` + `headcount-groky-adaptation.md` only; `Select-String "creative"` returns nothing.
- `git ls-tree -r --name-only origin/main -- docs/planning/creative-platform/` returns nothing.
- Same result on former HEAD `48d8cef` (`feat/groky-headcount-reference-20261003`), which only adds `archive/legacy-v0/HEADCOUNT_*` reference material + `docs/planning/headcount-groky-adaptation.md` (review-only, non-deployable).

Consequence: the questionnaire in item 7 cannot be answered verbatim. This file instead answers the 18 explicit investigation items from the assignment (§2) against CURRENT source. Current source wins over any old planning or chat history. `archive/legacy-v0` is reference/recovery only per `archive/legacy-v0/README.md:1-22` and is never cited as implementation.

Spot-verified in this pass (in addition to full grep/migration review):

- `apps/dashboard/lib/server/auth.ts:11-75`, `authorization.ts:1-45`, `database.ts:1-29`
- `apps/dashboard/app/layout.tsx:1-29` (Inter latin-only, `<html lang="en" dir="ltr">`)
- `.env.example:1-93` (all provider/automation flags `false`)
- `n8n/workflows/README.md:1-43`, 16× `"active": false` (verified by grep)
- `packages/agent-runtime/workspace.mjs:1-52`
- `packages/database/migrations/0001_shared_foundation.up.sql` (`agent_jobs:82`, `outbox_events:327-340`), `0008_customer_integrations.up.sql` (`organizations:3`, `integration_connections:43-82`), `0035_agency_workspace.up.sql` (`agency_workspaces:16`)

---

## 1. Reconciliation answers (current source only)

> Convention: `PRESENT` = implemented in source cited. `ABSENT` = not found after grep of `apps/`, `packages/`, `n8n/`, `config/`, `skills/`, `prompts/`, `services/`, `deployment/`, migrations. No speculation.

### 1.1 Existing tenant model — PRESENT (org-scoped, no RLS policies)

- `tanaghom.organizations(id, slug, name, is_active)` + seed `10000000-…-0001 / tanaghom`: `packages/database/migrations/0008_customer_integrations.up.sql:3-10`.
- Tenancy key: `organization_id uuid NOT NULL REFERENCES organizations(id)` added to `app_users`, `campaigns`, `publishing_channels` (`0008:15-27`), `integration_connections` (`0008:45`), `ghl_inbound_events` (`0012:32-68`), `ghl_action_jobs UNIQUE(organization_id,idempotency_key)` (`0015:91,116`), `organization_agent_jobs + UNIQUE(org,key)` (`0030:70-80,118`), `agency_pilot_tasks` (`0034:67,87`), `agency_workspaces UNIQUE(org,key)` (`0035:16-34`).
- No RLS: `grep "ROW LEVEL SECURITY|CREATE POLICY" packages/database/migrations/*.sql` = 0 hits. Roles are `NOBYPASSRLS` but RLS is never enabled.
- Resolver is application-side, no `resolve_tenant()` function: `apps/dashboard/lib/server/authorization.ts:30-44` looks up `app_users` by `auth_subject` and returns `organizationId`; every service filters `WHERE organization_id = $1` (e.g. `apps/dashboard/lib/server/agency-workspace.ts:40,44,51`, `conversation-supervision.ts:38,77`).
- Cross-tenant guards are DB functions raising `cross-tenant … forbidden`: `assert_organization_agent_owner` (`0029:218-239`, called `0035:79,104`, `0034:125,145,160,171`), `assert_organization_skill_owner` (`0027:102`), `enforce_*_integrity` (`0029:263,301,376,390,445`; `0027:157,196,252`; `0026:245,272,298`).

Implication for Creative Runtime: tenant = `organization_id` carried on every job/asset/ledger row + app-side scoping + DB owner-assert functions. No new tenant system.

### 1.2 Authentication model — PRESENT (Supabase JWT, server-only)

- Issuer/JWKS: `apps/dashboard/lib/server/auth.ts:11-21` (`issuer=${SUPABASE_URL}/auth/v1`, `jwksUrl=SUPABASE_JWKS_URL || …/.well-known/jwks.json`).
- Verify: `auth.ts:53-75` (`jwtVerify(..., {issuer, audience:'authenticated'})`, `sub` must be UUID).
- Token source: `auth.ts:23-30` (`Authorization: Bearer` else cookie `tanaghom_access_token`, else `Session token required`).
- Login proxy (no custom password store): `apps/dashboard/app/api/auth/login/route.ts:26-32` proxies to `${SUPABASE_URL}/auth/v1/token?grant_type=password` with publishable key; `48-49` sets cookies.
- Cookies: `apps/dashboard/lib/server/session-cookies.ts:3-27` (`tanaghom_access_token` httpOnly/lax/`/`/≤24h + `tanaghom_refresh_token` httpOnly/strict/`/api/auth`/30d); `refresh/route.ts:28-34`, `logout/route.ts:8-14` (clear only), `session/route.ts:9`.
- No `middleware.ts`; equivalent is `apps/dashboard/proxy.ts:3-17` (cookie presence → else `/login`, matcher excludes `api|_next…`). Cookie-mutation CSRF: `auth.ts:32-51` (`enforceSameOriginForCookieMutation`, skipped when `Authorization` header present).

Implication: Creative endpoints reuse `authenticate()` + cookies/Bearer. No new identity system.

### 1.3 Authorization helpers — PRESENT (role gate + DB policy functions)

- App roles: `apps/dashboard/lib/server/authorization.ts:8-22` (`owner|reviewer|operator|viewer`); `authorize(request, allowedRoles)` throws `AuthorizationError` unless role included.
- Usage: `owner`-only (`team-management.ts:40,92`; `integration-management.ts:125,154,202,262,305`; `agency-pilot.ts:53`); mixed (`content-decision.ts:85` owner+reviewer; `audit/route.ts:11` all four).
- DB policy: `assert_organization_agent_owner`, `assert_organization_skill_owner` (§1.1); workspace decisions `decide_agency_workspace` (`0035:145-147`: `owner` any action, `reviewer` approve/reject only); triggers `enforce_human_content_decision` (`0001:138-159`), `enforce_publishable_content` (`0001:245-266`).
- `packages/contracts/*` holds JSON schemas only (no code helpers): `schemas/phase*/*.v1.schema.json` + `README.md`.

Implication: Creative approve/reject/revoke/credit actions reuse `authorize()` + owner/reviewer split + DB asserts. Voice-consent and publish actions need owner-level gates (new functions, same pattern).

### 1.4 Database role model — PRESENT (least-privilege roles, no gateway role)

- Roles (`NOLOGIN…NOBYPASSRLS`): `tanaghom_api, tanaghom_n8n_worker, tanaghom_readonly` (`0004:5-13`); `tanaghom_conversation_worker` (`0012:8-9`); `tanaghom_agent_runtime, …_skill_read/proposal/action_executor` (`0030:7-22`); `tanaghom_agency_pilot_worker` (`0034:10-11`).
- No `tanaghom_gateway` role. “Gateway” is logical: `executor_type='private_gateway_operation'` (`0026:94,213-218`), `integration_requirement IN ('postiz_private_gateway','ghl_private_gateway')` (`0030:245`), `executor_ref='provider-gateway'` (`0031:451`).
- Least privilege: `0004:17-46` (`REVOKE ALL … FROM PUBLIC`, `GRANT USAGE + SELECT` to api/readonly, narrow `INSERT` to api, `UPDATE(status)` on `content_items` to api); per-migration e.g. `0008:331-336`, `0009:409-420`, `0035:276-283`; exhaustive `REVOKE ALL ON FUNCTION … FROM PUBLIC` + `GRANT EXECUTE … TO tanaghom_api|…_worker` (e.g. `0005:451-461`, `0012:580-594`, `0015:641-659`).
- Connection: `apps/dashboard/lib/server/database.ts:9-22` single `Pool(DATABASE_URL)` (`application_name=tanaghom-dashboard-api`), no `SET ROLE`. Restricted URLs are documented intent (`.env.example:83-93`: dedicated restricted role, never owner/service/admin) but dashboard code uses one pool.

Implication: Creative workers need a new least-privilege role (e.g. `tanaghom_creative_worker`) granted only `claim/complete` on creative-job functions + no direct table writes — same pattern as `tanaghom_n8n_worker` / `tanaghom_agency_pilot_worker`. To be designed in a later migration PR, not here.

### 1.5 Audit infrastructure — PRESENT (append-only, correlated)

- Tables: `agent_actions_log(id, correlation_id, job_id, agent_id, actor_user_id, action_type, entity_type, entity_id, payload, result)` (`0001:354-367`); `ghl_action_outcomes/approvals` (`0015:135-160`); `skill_audit_events` (`0026:149`); `organization_skill_audit_events` (`0027:85`); `organization_agent_audit_events` (`0029:200`); `organization_agent_runtime_events` (`0030:263`); `agency_pilot_events` (`0034`); `agency_workspace_events/steps` (`0035:35-41`).
- Immutability: `prevent_audit_mutation` + triggers `audit_no_update/audit_no_delete` (`0001:369-376,392-393`); `workspace_events/steps_immutable` + `guard_workspace` (`0035:52-63`); `prevent_ghl_action_outcome_mutation` (`0015:162-164`); `enforce_skill/organization_skill/organization_agent_audit_integrity` (`0026:278-287,313`; `0027:240-269`; `0029:433-471`).
- Correlation: `correlation_id uuid NOT NULL` on `agent_jobs:84`, `external_operations:313`, `outbox_events:329` (`event_key UNIQUE:330`), `agent_actions_log:356`; `ghl_inbound_events.correlation_id UNIQUE` (`0012:34`); `ghl_action_jobs.correlation_id UNIQUE` (`0015:74`); indexes (`0001:399,401`); read path `app/api/audit/route.ts:17-30`.

Implication: every creative job transition, reservation/settlement, consent grant/revoke, approval, and publish check must append here with `correlation_id`. No separate creative audit log.

### 1.6 Idempotency infrastructure — PRESENT (keys + replay guards, app + DB)

- Keys: `api_idempotency_keys(actor_user_id, operation_type, idempotency_key[8-128], request_hash sha256 hex, status processing|completed, response_*) UNIQUE(actor,operation,key)` (`0003:3-20`); `external_operations UNIQUE(provider,operation_type,idempotency_key)` (`0001:316-324`); `UNIQUE(organization_id,idempotency_key)` on `ghl_action_jobs` (`0015:116`), `organization_agent_jobs + invocations` (`0030:78-80,118,186-217`), `agency_workspaces` (`0035:33`); `outbox_events.event_key UNIQUE` (`0001:330`); `ghl_inbound_events UNIQUE(connection,provider_event_id)` (`0012:68`).
- App dedupe: `content-decision.ts:28-34,94-128` (mirrored in `campaign-management.ts:81-153`, `postiz-handoff.ts:20-102`, `ghl-contact-sync.ts:22-79`): `Idempotency-Key[8-128]` → `INSERT … ON CONFLICT DO NOTHING` → hash compare else `409 idempotency_key_reused`, replay cached with `Idempotency-Replayed:true`.
- DB replay: `create_agency_workspace` (`0035:87-88` return existing on same hash, raise on conflict); `complete_agency_workspace_task` (`0035:241-244` replay on same `response_hash`); `queue_postiz_draft` (`0007:214-217`, `0008:304-307` raise on replay); `queue_ghl_contact` (`0011:299-313`); `prepare_ghl_action` (`0015:524`); `replay_ghl_inbound_event` (`0012:521-571` only from `dead_letter`, `replay_count+1`).

Implication: creative jobs reuse `UNIQUE(organization_id,idempotency_key)` + `ON CONFLICT` + hash compare. Provider retries must record `indeterminate`, never blind-retry billed calls.

### 1.7 Background-work / outbox primitives — PRESENT (DB-driven, no Bull/pgboss/pg_cron)

- Outbox: `outbox_events(..., status pending|processing|published|failed DEFAULT pending, attempt, available_at, published_at)` (`0001:327-340`) + `outbox_events_claim_idx WHERE status IN ('pending','failed')` (`0001:399`). Writers in `0005:195,340`, `0007:117,312`, `0008:199`, `0010:240,450`, `0011:184,376`, `0023:90,191,285,400,562`, `content-decision.ts:174`.
- Queues (no generic lib): `agent_jobs(id, correlation_id, job_type, status queued|running|waiting_approval|succeeded|failed|cancelled, attempt, max_attempts, input/output, available_at, started/ finished_at)` (`0001:82`) + `agent_jobs_claim_idx WHERE queued` (`0001:398`); `external_operations` (`0001:311`); `api_idempotency_keys` (`0003`); domain queues (`publishing_channels 0007:8`; `ghl_action_jobs/approvals/outcomes 0015:72,135,148`; conversation registries `0013/0014/0018`; `0022_agent_registry`; `0024_conversation_intelligence_worker_registry`).
- Claim/retry: `claim_agent_job` (`0005:3-62`: `FOR UPDATE SKIP LOCKED ORDER BY available_at`, `attempt<max_attempts`, `queued→running`); `record_agent_job_failure` (`0005:351-402`: `retry_after_seconds 0-86400`, requeue or `failed`, `available_at=now()+interval`); per-domain variants (`record_postiz_draft_failure 0007:353` with 429 handling; `record_postiz_performance_failure 0010`; `record_ghl_contact_failure 0011`; `begin_agent_runtime_provider_dispatch 0030/0031`).
- No Bull/pgboss/pg_cron in migrations; only cron placeholders (`.env.example:76-77`). Execution = n8n `scheduleTrigger` polling (§1.11) + private gateway routes (`app/api/internal/agent-runtime/provider/route.ts:332`, `internal/integrations/postiz/draft|analytics`, `internal/integrations/ghl/contact|action`).

Implication: Creative jobs follow the same durable pattern (`queued→claimed→running→succeeded|failed|cancelled|expired` with `SKIP LOCKED`, lease, backoff). New tables/functions later; no new queue infra class in this PR.

### 1.8 Existing media handling — MINIMAL (text fields only, no asset model)

- PRESENT: `content_items(campaign_id, strategy_id, parent_content_id, generation>0, channel, content_type post|reel_script|ad_copy|email, draft_copy, media_brief text NOT NULL, media_url text NULL, status…)` (`0001:105-123`); non-empty `media_brief` enforced (`0005:285`); contracts require `media_brief 1..5000` (`phase3/content-producer-output.v1.schema.json:13,19`); Postiz command carries `media_url` (`phase7/postiz-draft-command.v1.schema.json:28`); regeneration via `parent_content_id+generation UNIQUE` (`persist_content_result 0005:268-278`); Postiz image payload currently `jsonb_build_array()` empty (`0008:290-297`) or `[media_url]` (`provider/route.ts:157-158`); brand link is `asset_ids: c.media_url ? [c.id] : []` (`packages/agent-runtime/integration.mjs:102`).
- ABSENT: no `media/asset/version/product_photo` table; no image/video/audio columns, thumbnails, object keys, or media job queue (only `content_type` enum + `media_url text`). `skill_registry.reference_type='asset'` is an enum value, not storage; `asset_rights` is workspace evidence text.

Implication: genuine `CreativeAsset → CreativeAssetVersion → CreativeJob` model is NEW WORK (see §3).

### 1.9 Existing storage implementation — ABSENT

- S3/AWS env/vars: none (`S3_*`, `AWS_*` absent from `.env.example`, `apps/dashboard`, `config/`).
- Supabase Storage: none. `apps/dashboard/lib/server/supabase-admin.ts:14-58` only calls `auth/v1/invite` + `auth/v1/admin/users`; no `storage/v1` or `createSignedUrl`.
- Local media volume: none. Compose volumes only mount `pgdata:/var/lib/postgresql/data` (e.g. `deployment/fresh-test-vps/compose.yml:15`).
- Buckets/signed URLs/thumbnails/uploads: none (`grep S3|bucket|signedUrl|thumbnail|upload` in `apps/dashboard` finds only `secure_storage_configured:boolean` referring to the encryption key in `integration-management.ts:139`, `notification-management.ts:165`).
- Deps: `apps/dashboard/package.json:11-18` (`next, pg, jose, react`) — no `@supabase/*-storage`, `aws-sdk`, `sharp`, `multer`.

Implication: S3-compatible abstraction (private buckets, signed previews, immutable keys, checksums, proxies, tenant isolation, retention/deletion) is NEW WORK.

### 1.10 Existing integration-vault behavior — PRESENT (AES-256-GCM, gateway-mediated)

- Table: `integration_connections(organization_id, provider postiz|ghl, status configured|connected|error|disconnected, base_url, credential_kind api_key|private_token|oauth, credential_ciphertext bytea, credential_nonce bytea(12), credential_auth_tag bytea(16), credential_key_version int, secret_last_four(4), configuration jsonb, …, UNIQUE(org,provider), CHECK disconnected⇒nulls else lengths>0)` (`0008:43-82`); redacted view `integration_connection_status` (`0008:98-103`); `REVOKE ALL … FROM PUBLIC,readonly,n8n_worker; GRANT SELECT,INSERT,UPDATE,DELETE TO tanaghom_api` (`0008:331-334`).
- Crypto: `apps/dashboard/lib/server/integration-crypto.ts:15-77` (32B base64 key `INTEGRATION_CREDENTIAL_KEY`, version `INTEGRATION_CREDENTIAL_KEY_VERSION`, AES-256-GCM nonce-12, `decryptCredential` strict version match, `credential_encryption_not_configured|key_invalid|decryption_failed`).
- Providers: `integration-providers.ts:33-44` (Postiz `https://api.postiz.com/public/v1` api_key; GHL `https://services.leadconnectorhq.com` private_token); `:120` connection tests (Postiz `/is-connected` + `/integrations≤250`; GHL `/locations/{id}`); `:174` Postiz draft, `:183` analytics, `:200` GHL upsert, `:242` GHL action, `:226` dispatch validation.
- Gateway: all five internal routes require `timingSafeEqual(INTEGRATION_WORKER_TOKEN≥32)` (`internal/integrations/postiz/draft/route.ts:11-15`, `postiz/analytics:12`, `ghl/contact:12`, `ghl/action:16`, `agent-runtime/provider:39-44`); server-side decrypt + base-URL allowlist + exact contract + `parameter_hash` + idempotency key; gateway never returns secrets.
- Flags: `.env.example:42-53,68-73` (`INTEGRATION_CREDENTIAL_KEY[_VERSION]`, `INTEGRATION_WORKER_TOKEN`, `AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=false`, `POSTIZ_*/GHL_*_ENABLED=false`, `*_READY=false`, `TANAGHOM_INTEGRATION_GATEWAY_URL=`, `ALLOW_STAGING_PUBLISH=false`).

Implication: model-provider keys (if any are ever stored) reuse this vault + gateway pattern. This PR adds no keys.

### 1.11 Current n8n execution boundaries — PRESENT (16 inactive exports, DB-authorized only)

- 16 exports, all `"active": false` (grep confirms; e.g. `phase3/content-producer.v1.json:282`): `phase3/campaign-strategist.v1.json`, `phase3/content-producer.v1.json`, `phase4/postiz-draft-publisher.v1.json`, `phase4/postiz-performance-monitor.v1.json`, `phase5/ghl-contact-sync.v1.json`, `phase5/governed-ghl-actions.v1.json`, `phase5/conversation-intelligence.v1.json`, `phase5g/quality-shadow-evaluator.v1.json`, six `phase7d/*`, `agency-pilot/simulation.v1.json`, `agency/agency-workspace.v1.json`.
- Pattern: `manualTrigger + scheduleTrigger` (poll every 1m / 30s, committed disabled) → `postgres claim_*()` with stub credential `62000000-…` → `httpRequest` to Gemma (`https://api.thesmartlabs.net/gemma4/v1/chat/completions`, stub header-auth) or private gateway (`$env.TANAGHOM_INTEGRATION_GATEWAY_URL + /api/internal/integrations/…`) → `persist/complete/record_*()`; `settings.executionTimeout`, `save*` minimized; `retryOnFail:false` on agency tick.
- Generators (not daemons): `scripts/generate-phase3/4/5/5g/7d/agency-pilot-workflow.mjs` + validators (`n8n-workflow-integration.mjs`, `n8n-postiz/ghl/quality-shadow/phase7d-runtime-certification-integration.mjs`).
- Boundary docs: `docs/architecture/0003-database-role-boundaries.md:19-53` (worker reads only, `SECURITY DEFINER` functions only, never `content_approvals`); `n8n/workflows/README.md:17-43` (publisher draft-only + approval recheck, monitor via gateway, GHL queued upsert only, no token/URL retention, indeterminate timeouts).
- Webhooks: no `webhook` trigger in current exports (only legacy `archive/legacy-v0/n8n/workflows/*.json`, marked inactive reference). Dashboard ingress signing is GHL Ed25519 (`app/api/webhooks/ghl/route.ts:49`, `lib/server/ghl-inbound-webhook.ts:118-137`, `GHL_WEBHOOK_INGRESS_ENABLED=false` default); n8n→dashboard auth is Bearer worker tokens (`AGENCY_PILOT/WORKSPACE_WORKER_TOKEN`, `.env.example:84-93`).

Implication: Creative workers (self-hosted or n8n-assisted) claim DB-authorized jobs and complete via controlled functions. n8n is never source of truth and never publishes directly.

### 1.12 Current dashboard API patterns — PRESENT (~50 routes, uniform shape)

- Routes (`export const runtime = nodejs`): `campaigns`, `campaigns/[id]/{strategy,content,ready}`, `content`, `content/[id]/postiz-draft`, `approvals{,/[id]/decision}`, `ghl-actions{,/[id]/{decision,reconcile}}`, `conversations{,/[id]{,/transition,/reply-draft,/emergency}}`, `admin/integrations{,/[provider]{,/test},/postiz/channels}`, `admin/automation/{postiz,ghl}`, `admin/{agents,knowledge,skills,users,notifications}`, `auth/{login,logout,refresh,session,accept-invite}`, `audit|health|operations|quality|workspace`, `system/monitoring`, `webhooks/ghl`, `internal/integrations/postiz/{draft,analytics}`, `internal/integrations/ghl/{action,contact}`, `internal/agent-runtime/provider`, `internal/agency-{pilot,workspace}`, `leads/[id]/ghl-contact`.
- Pattern: `authorize()` (§1.3) → org-scoped `database().query` (e.g. `app/api/content/route.ts:14`, `lib/server/campaign-management.ts:167,196`).
- Validation: NO zod (`grep zod` = no files; not in `apps/dashboard/package.json`). Manual bounded validators (`campaign-management.ts:30-67`, `integration-providers.ts:214`, `integration-management.ts:50`, `provider/route.ts:46-67`, `ghl-inbound-webhook.ts:58-104`) + versioned JSON-schema contracts (`packages/contracts/schemas/phase*/…`, Ajv only in `packages/agent-runtime/integration.mjs:14`, inline `json_schema` in n8n exports).
- Errors: `lib/server/responses.ts:6-12` (`Cache-Control:no-store`, `{error:…}` with 401/403/503); per-domain `*RequestError(code,status)`; gateway `{error, dispatch_started, dispatch_id, invocation_id}`; webhook `X-Tanaghom-Webhook-Status`.

Implication: Creative APIs follow the same shape (`authorize` → validate → `idempotentMutation` → DB function → `{…}` / `{error:…}`, `no-store`). Dashboard never orchestrates models directly; it calls the Creative Service.

### 1.13 Current feature-flag mechanism — ENV + singleton control tables (no flag registry)

- No `flags` table, no `config/*flag*`, no per-tenant flag system (`grep feature_flag` = only `*_ENABLED`, `emergency_stop`, `available/activated=false`, CLI `--flag`).
- Env gates (all `false` in `.env.example:47-54,70-73,83-93` and `deployment/fresh-test-vps/compose.yml:40-50`): `AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED`, `POSTIZ_*_ENABLED`, `GHL_*`, `GHL_ACTION_RUNTIME_READY`, `POSTIZ_HANDOFF_ENABLED`, `POSTIZ_AUTOMATION_RUNTIME_READY`, `ALLOW_STAGING_PUBLISH`, `AGENCY_PILOT_GATEWAY_ENABLED`, `AGENCY_WORKSPACE_ENABLED` (+ `*_DATABASE_URL`, `*_WORKER_TOKEN`).
- DB singletons: `agency_workspace_control(singleton, enabled DEFAULT false, emergency_stop DEFAULT true, reason='…not been enabled')` (`0035:8-15`); `agent_runtime_controls(singleton, emergency_stop DEFAULT true)` (`0030:48-50,400-401`); per-org policy columns (`conversation_emergency_stop 0014:4`; `action_emergency_stop 0015:8`).
- Code gate: `agency-workspace.ts:17` requires `AGENCY_WORKSPACE_ENABLED==="true" && GEMMA_API_KEY && AGENCY_WORKSPACE_DATABASE_URL && WORKER_TOKEN≥32`.
- Tests pin fail-closed: `tests/fresh-test-vps.test.mjs:14`, `scripts/validate-agency-runtime.mjs:26`.

Implication: Creative capabilities gate the same way (env + control singleton + emergency stop, default off). No new flag framework in this PR.

### 1.14 Existing RTL/i18n support — PARTIAL (direction-aware, bilingual schemas; no locale system, no Arabic font)

- Direction-aware UI PRESENT: `dir={lang==='ar'?'rtl':'ltr'}` in `agency-workspace.tsx:75,90,97,99`, `supervisor-inbox.tsx:229,239,249-252`, `knowledge-management.tsx:183,213`, `ghl-action-review.tsx:79,162`, `agent-studio.tsx:485`, `skill-library.tsx:281,313`; `:dir(rtl)` CSS overrides in `globals.css:760,1575-1578,1773-1776,2076-2078`.
- Bilingual schemas PRESENT: `CHECK(language IN ('en','ar'[,'und']))` in `0013:35,79-80,140,164`; `0014:31,115`; `0015:29`; `0021:50`; `0029:53,184`; `0030:96`; `0034:68`; `0035:23`; `0023:50-54,156-160`; runtime enforcement `workspace.mjs:12,16,32-36,44` (Arabic mismatch throws `workspace_language_mismatch`); `agency-workspace.v1.json:6-11`.
- Locale files ABSENT (`Glob **/*locale*` = none; no next-i18n/react-intl/`NEXT_*LOCALE`; only `localeCompare`/`toLocaleString`).
- Arabic font ABSENT: `app/layout.tsx:2,7,23` (`Inter({subsets:['latin']})`, `<html lang="en" dir="ltr">`); `globals.css:47` Inter stack only; zero Cairo/Tajawal/Noto-Arabic hits.
- Tests PRESENT for direction/bilingual (not fonts): `agent-studio.test.mjs:157`, `dashboard.test.mjs:78,214`, `skill-library.test.mjs:97`, `repository.test.mjs:438`, `agency-quality-preparation.test.mjs:18,21`, `agency-quality-runner.test.mjs:22`, phase6/7f bilingual suites.
- Acceptance gap: `WORKSPACE_DELIVERY.md:46,51,61` (retain Inter, Arabic direction support, real AR model output unchecked); `STATUS.md:49,65,109` (12 bilingual round-trips pass, 14/14 sim scenarios, #14 browser/RTL acceptance still open).

Implication: Arabic-first creative UX (fonts, RTL App Router routes, shaping/reshaping tests, motion captions) is NEW WORK with #14 owning acceptance.

### 1.15 Current deployment topology — PRESENT (compose packages + Caddy/Nginx, one Dockerfile)

- Compose (7 files): `deployment/dashboard-canary/docker-compose.yml` (healthcheck `:40-41`); `deployment/dashboard-public/docker-compose.yml` (`APP_BASE_URL https://tanaghom.38-247-187-232.sslip.io :5`); `deployment/fresh-test-vps/compose.yml`; `deployment/agency-workspace/compose.yml` (overlay `workspace-n8n` + `workspace` net); `phase5f-retention|dependency-loss|runtime-recovery`; `phase4-postiz-activation/docker-compose.n8n-gateway.yml`; `phase3-shadow-canary/docker-compose.database-egress.yml`.
- Single Dockerfile: `deployment/dashboard-canary/Dockerfile:1-36` (3-stage `node:24.18.0-alpine3.24`, `build:dashboard`, `.next/standalone`, copies `agent-runtime/contracts/config/skills/prompts/n8n/workflows/phase7d`, `USER node`).
- Edge: test VPS Caddy (`fresh-test-vps/Caddyfile:1,14-15`; `agency-workspace/Caddyfile:1,12-17` with `@private /api/internal* → 404`); prod `38.247` Nginx (`dashboard-public/nginx/tanaghom.conf:6,22,25-26`, letsencrypt).
- Hosts: test `155.117.45.45` (`tanaghom-test.155-117-45-45.sslip.io`, RUNBOOKs + `STATUS.md:24-35`); certified `38.247.187.232` (`tanaghom.38-247-187-232.sslip.io`, `dashboard-public/RUNBOOK.md:3,29-31`); 44 `deployment/*` packages each with `RUNBOOK.md` + `validate-package.sh/common.sh/deploy*.sh`.
- Health: pg `pg_isready` (`fresh-test-vps/compose.yml:17-21`); dashboard `fetch(/api/health)` (`:70-75`); n8n `fetch(:5678/healthz/readiness)` (`agency-workspace/compose.yml:55-60`); `deploy.sh:72-83` + 100+ `grep health` hits.
- CI: `.github/workflows/quality.yml:1-1086` (`agency-workspace`, `repository-contract`, `database-contract` pg:16 `MIGRATION_TARGET:0034`, `dashboard-image-contract`).

Implication: Creative workers ship as additive compose overlay(s) on the test host only, behind existing health/rollback discipline. No topology change in this PR.

### 1.16 Current production/test separation — PRESENT (isolated test stack)

- `.env` + `.env.example` both exist; example is placeholders only (`APP_ENV`, `DATABASE_URL=…/tanaghom_agents` vs `DATABASE_TEST_URL=…/tanaghom_agents_test`, `AGENCY_*_DATABASE_URL`, server-only Gemma note `:59-60`).
- Test DB: `fresh-test-vps/RUNBOOK.md:18-19` (ONLY new local `tanaghom_test`, never dev `DATABASE_URL`); `:75-78` (apply `.up.sql` via local socket, `public.schema_migrations` ledger); `compose.yml:12` (`POSTGRES_DB: tanaghom_test`, `database:{internal:true}`, no published PG/dashboard ports `:42`).
- Host: `APP_BASE_URL https://tanaghom-test.155-117-45-45.sslip.io` (`compose.yml:36`); expected-URL checks (`validate.sh:33`, `deploy.sh:46`, `RUNBOOK.md:102`); `down -v` forbidden (`:113-124`).
- Migrations: `scripts/database.mjs:7,20,26` (require `DATABASE_URL`, `.up/.down`, known `DATABASE_MIGRATION_TARGET`); `scripts/database-test.mjs:71-72,102-172` (migrate×2 + per-version rollback 0034→0001); `0035:3-6` exact-0034 baseline guard; `agency-workspace/RUNBOOK.md:70-73,116-118` (build-first, encrypted `pg_dump`, only `0035`, down-file refuses if assignments exist).
- Secrets: `fresh-test-vps/compose.yml:107-115` (`/opt/tanaghom-test/runtime/secrets/*`, root-owned 0700, `root:1000/0640`); `RUNBOOK.md:68-73` + `agency-workspace/RUNBOOK.md:23-28` (never in Git/CLI/logs/UI/workflow JSON; Supabase URL/publishable/JWKS only, no admin key, fresh vault/worker keys, no provider creds/campaigns/leads); `prepare-secrets.py:7`.

Implication: creative test data/secrets stay in the isolated test stack under the same rules. Production/test separation is policy + compose + runbook, not a new system.

### 1.17 Existing video initiative ownership — #157 OWNS (no implementation)

- Ownership: `STATUS.md:153-155` (`#157 video retains ownership, no duplicate executor`); `planning/agency-expansion/TRACKING_RECONCILIATION.md:89-97` (`#157 canonical optional isolated video-draft worker; persona claims ≠ renderer, no GPU auth`); `planning/agency-expansion/README.md:121`; `issues/epic.md:85`; `issues/dept_media.md:31`; `issues/dept_commercial.md:37`; `existing-issues/131.md:5`; evidence index `evidence/2026-09-06-pre-expansion-github-issues.json:12`.
- No video source: `Grep video` in `docs/evidence` = 0; no `**/*video*` source file; `Grep Remotion|MuseTalk|Comfy|Flux|XTTS` repo-wide (excl. node_modules/.git) = 0; `skills/` (6 pilot `*.skill.json` + 8 `platform/SKILL.md`) and `prompts/` (strategist v1/v2, content-producer, conversation-*, policy-resolved-agent, quality-shadow) contain zero video/creative hits; `skills/pilots/agency-v1/README.md:57` lists video/audio execution under *Explicitly removed*.

Implication: AI video/talking-head work must coordinate with #157 as `EXISTING ISSUE/ROADMAP OWNS THIS`, not as a fresh duplicate.

### 1.18 Overlap with Agency/workspace capabilities — PRESENT (document lane, reuse pattern)

- UI: `apps/dashboard/components/agency-workspace.tsx:1-112` (assignments, team/single, en/ar, brief 30-6000 + source_facts 20-6000, idempotency key, 5s poll, Deliverable/Shared-context/Activity tabs, Start/Pause/Resume/Cancel, Approve/Request-changes with `result_hash`, Export `.md`).
- Server: `apps/dashboard/lib/server/agency-workspace.ts:36-153` (`workspaceRead` with control+runtime readiness + `can_manage=owner`; `workspaceWrite` create/start/approve/reject/pause/resume/cancel, auto-draft missing `workspace_*` docs; `workspaceTick` with `AGENCY_WORKSPACE_WORKER_TOKEN≥32`, Gemma inventory `gemma4-26b-a4b-canary` check, `complete_agency_workspace_task()`).
- DB: `0035_agency_workspace.up.sql:8-63` (control/workspaces/steps/events + immutable triggers + `guard_workspace`); `:67-72` (patch `claim_agency_pilot` to exclude `workspace_contract='agency.workspace.v1'`); `:74-274` (create/start/claim/complete/`result_hash`/decide, 1-or-6 profiles, 20 open cap, 1 concurrency, 180s lease, 100 claims/24h, en/ar, artifact 20-16000 chars).
- Runtime: `n8n/workflows/agency/agency-workspace.v1.json:2-9` (`active:false`, 30s + manual → `POST dashboard:3000/api/internal/agency-workspace {"action":"tick"}`, stub auth `76000000-…0035`, no retries, 120s timeout, no save); `packages/agent-runtime/workspace.mjs` (6 profiles `draft_documents_only`, 1400 tokens/16000 chars/90s/`external_actions:0`; deterministic bilingual executive summary, `human_approved:false`).
- Scope: `WORKSPACE_DELIVERY.md:24-40` (additive 0035, workspace.v1 lane, reuse Studio validation, no response_format/tools/JSON to Gemma, private-gateway n8n); `STATUS.md:9-17` (PR #208 `208f6ce` 41/41 CI, deploy `369525f` test-only); `skill-registry.v1.json:1-388` (8 platform skills, no workspace/video/creative).

Implication: Creative Runtime reuses the workspace *pattern* (additive migration, versioned manifest + hash, assignment-local context, deterministic summary where possible, private tick, inactive n8n export) but is a separate bounded lane. Workspace code is not modified by this PR.

---

## 2. Existing architecture map (ACTUAL components)

### 2A. Current flow (pre-creative)

```
Human/User (browser, EN UI, Inter latin, dir mostly ltr + per-component rtl)
  ↓ HTTPS (Caddy test / Nginx prod) + APP_BASE_URL
Dashboard (Next.js apps/dashboard/app, components/*, proxy.ts cookie gate)
  ↓ authenticate() [auth.ts Supabase JWKS] → authorize() [authorization.ts role+org]
Authenticated server APIs (apps/dashboard/app/api/*, runtime=nodejs, no-store, {data}|{error})
  ↓ business services (apps/dashboard/lib/server/*-management.ts: campaign, content-decision,
      agency-workspace/pilot, integration-*, automation-*, agent-registry, conversation-*)
PostgreSQL (packages/database/*.up.sql, tanaghom schema, 0001→0035)
  │  • organizations/app_users + owner asserts + cross-tenant guards
  │  • agent_jobs + claim/record_* (SKIP LOCKED, lease, backoff) + outbox_events (claim idx)
  │  • api_idempotency_keys + UNIQUE(org,key) + ON CONFLICT replay
  │  • agent_actions_log + domain audit tables (immutable triggers, correlation_id)
  │  • integration_connections (AES-256-GCM vault) + redacted view
  │  • content_items (draft_copy + media_brief + media_url text) + approvals lineage triggers
  │  • agency lanes (pilot tasks + workspace assignments/steps/events)
  ↓ workflow/runtime dispatch (two kinds)
  ├─ n8n (n8n/workflows/*, ALL active:false, schedule/manual only, stub creds,
  │        claim_*() → Gemma https://api.thesmartlabs.net/gemma4/v1 (+sim stubs)
  │        or private gateway $TANAGHOM_INTEGRATION_GATEWAY_URL → persist/complete/record_*())
  └─ local adapters (packages/agent-runtime/*.mjs: workspace/agency-pilot/integration — Ajv, no DB writes)
  ↓ model/tool adapters (Gemma procedures via workspace.mjs/agency-pilot.mjs;
      Postiz/GHL only inside private gateway routes after decrypt + allowlist + contract checks)
External provider or self-hosted worker
  (Gemma shared endpoint; Postiz https://api.postiz.com/public/v1; GHL https://services.leadconnectorhq.com)
  ↓ artifacts back through gateway → controlled DB functions → versioned rows
Object storage: ABSENT (no S3/Supabase-storage/local media volume)
Creative Asset: ABSENT as entity (only content_items.media_url text + media_brief)
Human Approval: PRESENT (content_approvals lineage, workspace approve/reject with result_hash,
  GHL action approvals, owner/reviewer split, replay-safe)
Governed publishing: PRESENT as draft-only (Postiz type:draft + approval recheck + staging flags;
  GHL queued upsert/governed actions + consent/templates; ALLOW_STAGING_PUBLISH=false default)
```

Authoritative boundary reminders (do not regress):

- Dashboard is the authenticated API + human control plane, never a model orchestrator (`database.ts` single pool, `authorize` per route, gateway token separation).
- n8n is an executor of DB-authorized jobs, never source of truth (`0003-database-role-boundaries.md:19-53`, `n8n/workflows/README.md`).
- Provider secrets never leave the vault except inside gateway memory (`integration-crypto.ts`, `0008:331-334`).

### 2B. Where Creative Runtime belongs (bounded subsystem, placement only — no code here)

```
Tanaghom Dashboard (existing Next.js + authorize() + idempotentMutation)
  ↓ (existing API pattern; Creative routes added later under /api/creative/*)
Tanaghom authenticated API (existing shape; no direct model calls)
  ↓
Creative Service (NEW bounded service module under apps/dashboard/lib/server/creative/*,
                   thin: validate → policy → idempotency → enqueue → read-back; no provider SDKs)
  ↓
Creative Job (NEW durable rows: creative_jobs + transitions; UNIQUE(org,idempotency_key);
               correlation_id; capability enum; DB CHECK status queued|claimed|running|
               succeeded|failed|cancelled|expired — no free-form strings)
  ↓
Queue (existing pattern: claim_* FOR UPDATE SKIP LOCKED + lease + backoff + outbox_events)
  ↓
Worker (NEW least-privilege role tanaghom_creative_worker via controlled functions only;
         self-hosted GPU/CPU pool and/or DB-authorized n8n lane; test-host overlay only)
  ↓
Provider Adapter (NEW per-capability interface; implementations swappable, e.g.
                   ImageGenerator → ComfyUiImageAdapter today, FalImageAdapter tomorrow —
                   NO provider names in campaign/domain logic; licensing reviewed per adapter)
  ↓
Model/API (outside repo boundary; keys via integration vault + gateway, never in workflow JSON)
  ↓
Artifact (bytes to object storage — NEW S3-compatible abstraction, §1.9)
  ↓
Object Storage (private buckets, signed previews, immutable keys, checksums, proxies,
                 tenant isolation, retention/deletion — NEW)
  ↓
Creative Asset (NEW: CreativeAsset → CreativeAssetVersion → CreativeJob with parent links,
                 MIME/dims/duration/checksum/key/thumb/provenance/template ref/method/creator)
  ↓
Human Approval (EXISTING system extended: asset/version approve/reject with result_hash replay,
                 owner/reviewer split, stale/forge/double-publish guards per DEFINITION_OF_DONE)
  ↓
Existing governed publishing system (Postiz draft + recheck, GHL governed actions, staging flags —
  Creative NEVER publishes directly; execution re-checks approval+authorization)
```

All meaningful state stays in PostgreSQL; object bytes stay in object storage; audit stays append-only with `correlation_id`.

---

## 3. Gap matrix (requested capability → classification)

> Allowed: `ALREADY EXISTS` | `PARTIALLY EXISTS` | `NEW CAPABILITY` | `EXISTING CAPABILITY NEEDS EXTENSION` | `EXISTING ISSUE/ROADMAP OWNS THIS`. No duplication: where an issue owns it, that issue is named.

| # | Requested creative feature | Classification | Owning / evidence |
|---|---|---|---|
| 1 | Image generation (t2i, variants) | `NEW CAPABILITY` | No generator, no image table, no image adapter. Only `media_brief/media_url text` (§1.8). Future `ImageGenerator` contract + adapter. |
| 2 | Product photography (cutout → relight → bg → fidelity → variants) | `NEW CAPABILITY` | No segmentation/relight/composition/fidelity code. Fidelity checklist itself is new release requirement. |
| 3 | Image editing (bg replace, remove, enhance, inpaint) | `NEW CAPABILITY` | Same as 1–2. `media_url` passthrough only. |
| 4 | Advertising creative (multi-variant, multi-ratio, editable) | `NEW CAPABILITY` | No template/design-state store; `image: jsonb_build_array()` empty (`0008:290-297`). Structured design state is new. |
| 5 | Carousel generation (6–8 slides, order, per-slide edit/export) | `NEW CAPABILITY` | No slide/order/template tables. Must not store as unrelated images. |
| 6 | Arabic motion graphics (deterministic render) | `NEW CAPABILITY` | No renderer, no composition store. Direction-aware text exists in dashboard components only (§1.14), not a render engine. |
| 7 | AI video (t2v/i2v, scenes, B-roll, captions, soundtrack, cancel) | `EXISTING ISSUE/ROADMAP OWNS THIS` | #157 canonical optional isolated video-draft worker (`TRACKING_RECONCILIATION.md:89-97`, `README.md:121`, `epic.md:85`, `dept_media.md:31`). No implementation exists — coordinate, do not duplicate. Async jobs + cost/backpressure are new sub-requirements under #157. |
| 8 | Talking heads (portrait anim + lip-sync + captions + enhance) | `EXISTING ISSUE/ROADMAP OWNS THIS` (subsumed) | No talking-head code; media-phase ownership sits with #157 per §1.17. Stable business contract with swappable impl is new work under that issue. |
| 9 | Script generation (scene-planned copy feeding video/voice) | `PARTIALLY EXISTS` | `content_items(content_type=reel_script|ad_copy, draft_copy, media_brief)` + `content-producer` prompt/workflow exist. Scene plan/version/asset linkage is missing → needs extension, not a new writer. |
| 10 | Voice generation / TTS (AR/EN, brand voice) | `NEW CAPABILITY` | No TTS/voice-profile tables or adapters. Out of SmartLabs/SmartCC/voice scope (PROJECT_CONTEXT boundary) — isolated creative-voice only. |
| 11 | Voice cloning + consent ledger | `NEW CAPABILITY` | No consent table, no voice profiles, no hashes. Requirement: persisted consent (owner/subject, tenant, state, timestamps, source, purpose, revocation, audio hash, audit) with NO CLONE without consent. |
| 12 | Music generation (beds/stingers) | `NEW CAPABILITY` | No audio model/adapter/store. Lowest coupling; last priority. |
| 13 | Landing pages (RTL/LTR, brand, sections, responsive, versions, lead form→CRM) | `NEW CAPABILITY` | No page/section/version/publish tables. Constraint: lead forms must write to EXISTING lead capture + CRM lifecycle, never a side database. |
| 14 | Arabic-first UX (fonts, RTL routes, shaping, captions, mobile) | `EXISTING CAPABILITY NEEDS EXTENSION` | Direction-aware components + bilingual schemas exist (§1.14); locale system + Arabic fonts + render-time shaping + caption tests are missing. Acceptance stays under #14. |
| 15 | Brand management (canonical versioned Brand Kit) | `NEW CAPABILITY` | No brand-kit table. Per-tool branding must not be duplicated; one versioned kit consumed by ads/carousel/motion/video/landing/social. |
| 16 | Managed social content (objective→strategy→plan→generate→review→schedule→publish→perf→lead→CRM→attribution) | `EXISTING CAPABILITY NEEDS EXTENSION` | Lifecycle exists (campaign→content→approval→Postiz draft→monitor→GHL→report) with draft-only publishing + staging gates. Creative feeds it; must not circumvent it. Scheduler/cadence remain placeholders (`.env.example:76-77`). |
| 17 | Credits (ledger, reservation, settlement, reclaim, audit) | `NEW CAPABILITY` | No credit tables. Constraint: immutable `CreditAccount/CreditLedgerEntry/GenerationReservation/ProviderCostEntry` pattern (no `users.balance` column). Full audit linkage required. |
| 18 | Acquisition tools (free utilities, calculators, QR/barcode, etc.) | `NEW CAPABILITY` | No such tools in source. Treat as later growth surfaces reusing Creative Service + ledger, not a separate stack. |
| 19 | Gallery / growth surfaces (showcase, solutions, compare, guides) | `NEW CAPABILITY` | No gallery/solutions/compare tables or routes. Must derive from approved assets only (no unpublished drafts showcased). |
| 20 | Commercial capabilities (packages, trials, affiliates, payouts) | `NEW CAPABILITY` | No billing/affiliate tables. Depends on 17 + audit; out of this reconciliation PR. |
| 21 | Provider abstraction (`ImageGenerator`, `VideoGenerator`, …) | `NEW CAPABILITY` | No capability contracts exist. `packages/contracts` holds phase payload schemas only. Contracts + swappable adapters are new (no provider names in domain logic). |
| 22 | Creative jobs as first-class entities (queued→claimed→running→succeeded\|failed\|cancelled\|expired + UUID/tenant/user/capability/params/provider/model+version/job-version/correlation/idempotency/est.+actual cost/timestamps/error-class/retry/outputs/policy/audit) | `NEW CAPABILITY` (pattern exists) | `agent_jobs` + claim/retry + outbox pattern exists (§1.7) and must be followed, but no `creative_jobs` table/function exists. Constrained status enum required. |
| 23 | Versioned creative assets (`CreativeAsset→CreativeAssetVersion→CreativeJob` + parent links, MIME/dims/duration/checksum/key/thumb/provenance/template/method/creator) | `NEW CAPABILITY` | Only `media_url text` exists. Editing history/rollback/approval demands the full version graph. |
| 24 | Binary storage (S3-compatible, private, signed previews, immutable keys, checksums, proxies, tenant isolation, retention/deletion/backup) | `NEW CAPABILITY` | Entirely absent (§1.9). DB stores metadata/refs only. |
| 25 | Publishing boundary (Creative never publishes; governed system re-checks approval+auth; idempotent, forge/stale/retry-safe) | `ALREADY EXISTS` (to be reused) | Draft-only Postiz + approval recheck (`n8n/workflows/README.md:17-21`), GHL governed actions (`:38-43`), idempotency replay guards (§1.6), staging flags (`ALLOW_STAGING_PUBLISH=false`), human-decision triggers (`0001:138-159,245-266`). Creative must plug into this, not replace it. |

Deliberately NOT introduced here: duplicate Hermes (#150), flow-pack intake (#151), commercial skill executors (#152-155), MCP (#136/#156), or a second analytics executor — per `STATUS.md:153-155`.

---

## 4. Target-requirement notes (for later design PRs, not decisions in this PR)

- Provider abstraction is mandatory; business code never imports a provider SDK. Capability contracts first, adapters second.
- Jobs are async and durable; no synchronous GPU HTTP in request path. Statuses are CHECK-constrained.
- Assets are versioned objects; an edit is a new version with parent links, never a silent overwrite.
- Bytes live in object storage; Postgres holds metadata + refs + ledger + audit.
- Arabic text in visuals is deterministically rendered (overlay/composition), never diffusion-generated. Fonts, numerals, punctuation, wrapping, RTL alignment, carousel order, and motion captions are acceptance tests under #14 + DEFINITION_OF_DONE.
- One versioned Brand Kit feeds every visual surface.
- Product fidelity (logo, package text, shape, proportions, color, markings) is a release gate; silent product transmogrification fails acceptance.
- Ad/carousel/landing structured state stays editable; flat PNG/MP4 is an export, never the source of truth.
- Voice cloning requires persisted, revocable consent; browser-only checkboxes are insufficient.
- Landing lead forms write to existing lead/CRM lifecycle.
- Managed social reuses the governed publish path with approval + authorization re-checks at execution time.
- Credits are an immutable ledger with estimate → display → reserve → execute → actual-cost → settle → reclaim/audit.

---

## 5. Blockers / open questions (need owner input before any build PR)

1. The three creative-platform planning docs are missing (§0) — confirm whether `AGENT_COORDINATION.md`, `MASTER_PLAN.md`, and the canonical `MUSE_REPO_RECONCILIATION.md` questionnaire exist elsewhere or are superseded by this file.
2. Confirm #157 scope covers talking-head + video generation, or split them explicitly (no duplicate issue).
3. Confirm Arabic acceptance scope under #14 for creative surfaces (fonts, devices, caption timing) before any renderer PR.
4. Confirm test-host-only worker placement and secrets handling (existing runbooks apply; no new topology in this PR).
5. Confirm credit/commercial scope is out of the first build slice (recommend ledger + Brand Kit + asset/version + storage + one image/design lane first).

## 6. Definition of done for THIS reconciliation PR

- [x] Branch from `origin/main`, docs-only commit(s), no runtime/secret/n8n/GPU/production effects.
- [ ] Reviewers confirm §1 claims against cited files (spot-check at least auth, roles, audit, outbox, vault, workspace, n8n README).
- [ ] Reviewers confirm §3 classifications (especially 7–8 under #157, 9/14/16 as extensions, 25 as reuse).
- [ ] Missing planning docs disposition recorded (§5.1) — superseded vs to-be-provided.
- [ ] Follow-up build/ADR PRs scoped separately with their own DoD, tests, and rollback notes per `docs/DEFINITION_OF_DONE.md`.

Validation performed for this docs-only change:

- `git ls-tree` checks for missing planning path (recorded §0).
- `grep` for RLS/policies (0 hits), `"active": false` (16 hits), provider/creative terms (0 hits), `zod` (0 files), locale files (none).
- `git status --short` shows only `docs/planning/creative-platform/RECONCILIATION.md` added; `git diff --stat` contains no code/migration/workflow/secret changes (to be pasted in PR body).

*End of reconciliation — awaiting review. No build authorization is granted by this file.*
