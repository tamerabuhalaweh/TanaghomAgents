# Independent production-readiness review

Date: 2026-10-01 · Reviewed source: `main` at `b3e861903808c58f23654c1f4daf1f3a1600264d`
Reviewer: Emergent E1, independent of the original authors, at Tamer's request.
Scope: the existing sales/content/marketing pilot as defined in
[`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md). Source and CI only: no host,
database, model or provider was accessed. This review **does not change the official
scorecard**, which stays at **60/100, production NO-GO**.

## Two scores, kept separate

| Score | Value | Meaning |
| --- | --- | --- |
| Official evidence scorecard (repo, 20 gates) | **60/100** | 12 source gates evidenced; 8 runtime/customer gates need fresh proof. Unchanged by this review. |
| Independent code-readiness, `main` today | **67/100** | Weighted judgement of the source below. |
| Independent code-readiness, if readiness PRs #212–#217 merge | **81/100** | Same weights; assumes review acceptance, not deployment. |

The independent score is an engineering opinion, not gate evidence, and must never be
quoted instead of the official score.

## Area scores

| Area (weight) | Today | With PRs | Basis |
| --- | --- | --- | --- |
| Security (25%) | 70 | 85 | Strong tenant/role model and vault; stale dependency audit and missing defense-in-depth items |
| Reliability (20%) | 65 | 78 | Idempotency, retries, dead letters, stops; no alert delivery or external watchdog |
| Deployment (20%) | 60 | 78 | Careful runbooks/rollback; no single repeatable preflight; certified-host evidence is from July |
| Testing (20%) | 80 | 85 | 41 CI jobs, disposable PostgreSQL/n8n/browser harnesses; many source-regex contracts |
| AI cost and control (15%) | 55 | 80 | Tight per-call bounds and human approval; no spend cap, kill switch or real-model evidence |

## What is genuinely strong

- **Human approval is structural, not cosmetic.** Postiz drafts require an approved
  content item re-read by the database (`packages/database/migrations/0007_postiz_draft_handoff.up.sql`,
  `0008_customer_integrations.up.sql` `prepare_postiz_draft`); forged jobs are rejected in
  `scripts/n8n-postiz-workflow-integration.mjs`.
- **Least privilege and tenancy** are enforced in SQL roles and tested
  (`packages/database/tests/least_privilege_roles.sql`, `authorize()` in
  `apps/dashboard/lib/server/authorization.ts`).
- **Credentials** are AES-256-GCM encrypted, write-only and masked
  (`apps/dashboard/lib/server/integration-crypto.ts`, `notification-management.ts`); worker
  routes use timing-safe bearer checks; cookie mutations check same origin.
- **Fail-closed defaults:** every provider/model/notification path starts with
  `emergency_stop=true` and env flags `false` (`.env.example`, migrations 0009/0019/0030/0034/0035).
- **Evidence discipline:** dated evidence, versioned scorecard, frozen evaluation locks.

## Findings

| ID | Severity | Finding | Reference | Status |
| --- | --- | --- | --- | --- |
| S1 | Critical | `npm audit` fails on `main`: Next.js 16.2.11 (3 critical RCE advisories), sharp, fast-uri, baseline-browser-mapping. Every new PR fails `dashboard-contract`; the "Patch dependency audit" gate evidence is stale. | `package.json`, `package-lock.json` | Fixed in source by #215 (Next 16.3.8); hosts still need a reviewed rebuild |
| S2 | High | `main` has no branch protection; an admin token or mistaken push can bypass review and CI. | GitHub settings | Recommend protection + required checks |
| S3 | Medium | Postiz gateway forwarded `request_body` verbatim; draft-only relied on the database alone. | `apps/dashboard/app/api/internal/integrations/postiz/draft/route.ts` | Guard added in #213 |
| S4 | Medium | No Content-Security-Policy anywhere; test-host Caddy also lacks `X-Frame-Options` and login rate limiting (production nginx has both). | `deployment/fresh-test-vps/Caddyfile`, `deployment/dashboard-public/nginx/tanaghom.conf` | Open |
| S5 | Low | Login has no application-level throttling; it relies on nginx and Supabase. | `apps/dashboard/app/api/auth/login/route.ts` | Open (acceptable behind nginx) |
| R1 | High | Alert destinations save but never send; nobody is told about dead letters, uncertain GHL actions or cooldowns. | ADR 0011, `notification-management.ts` | Worker proposed in #216 (off by default) |
| R2 | Medium | `worker_unready`/`database_unavailable` cannot be detected from inside the database; no external uptime watchdog. | ADR 0011 | Open |
| R3 | Medium | No structured logging or error tracking in the dashboard; failures surface only as API codes. | `apps/dashboard/lib/server/*` | Open |
| D1 | High | No single repeatable check of what is running on the certified host; last record is 2026-07-28. | `docs/STATUS.md` | Read-only preflight in #214 |
| D2 | Medium | 44 one-off deployment packages make the current release path hard to identify. | `deployment/` | Open (consolidate after the next release) |
| T1 | Medium | Many tests assert source text with regular expressions; refactors break them without behaviour change. | `tests/dashboard.test.mjs`, `tests/repository.test.mjs` | Open |
| T2 | Low | No browser test of the authenticated Overview; known disabled Create campaign entry. | `apps/dashboard/components/overview-dashboard.tsx` | Fixed in #212 |
| A1 | High | No real model has run for the current release; the workspace label was static configuration, not a connection check. | `apps/dashboard/lib/server/agency-workspace.ts` | Probe + journey kit in #217 |
| A2 | Medium | No spend cap, run-level token budget or kill switch for model use; cost basis not recorded. | `config/agency-workspace.v1.json` | Limits + default-on kill switch in #217 |
| B1 | Info | No billing, subscription or pilot-fee flow exists. | whole repository | Open (Phase 3) |

## Readiness pull requests (none merged; each has tests, checks and undo steps)

| PR | Branch | Prepares gate |
| --- | --- | --- |
| #215 | `readiness/00-dependency-audit` | Restores the "Patch dependency audit" gate evidence; unblocks CI |
| #214 | `readiness/02-release-preflight-kit` | Fresh deployed baseline and security |
| #216 | `readiness/03-alert-delivery` | Operational delivery #46/#55 |
| #217 | `readiness/04-model-connection-and-journey` | Real-model bilingual journey (#177) |
| #213 | `readiness/05-postiz-draft-kit` | Postiz staging #45 |
| #212 | `readiness/06-dashboard-fixes` | Known caveat #14 (no gate) |

## Path to the official 80/100

All eight missing gates need real-world proof; code alone earns nothing. The four
closest gates need, in order:

1. Merge #215, rebuild and deploy the certified host from a reviewed package.
2. Run the #214 preflight there with `RESTORE_DRILL=true` → **65**.
3. Supply the model key, cost basis and customer-approved facts; run the #217 journey
   and complete the review sheet → **70**.
4. Supply a Postiz test workspace and channel; run the #213 kit → **75**.
5. Supply a test inbox or Slack channel and sign the capacity envelope; run the #216
   kit → **80**.

## Revenue verdict

**Not ready for unsupervised paid production.** After steps 1–5 the product is fit for a
**supervised paid pilot**: AI-drafted strategy and content in English and Arabic, human
approval in Tanaghom, and draft-only handoff to Postiz, with alerts to the operator.
Keep GoHighLevel outbound actions, live conversation automation and automatic publishing
off until their own gates (#53, #54, #56, #125) pass. Invoice the pilot fee manually; a
billing flow is a separate Phase 3 build.
