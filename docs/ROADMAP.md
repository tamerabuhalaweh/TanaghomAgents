# Delivery roadmap

## Target outcome

A polished operations platform where a business owner can create campaigns,
observe AI agents, approve or reject content, monitor publication and
performance, manage leads, and understand every automated decision from an
immutable audit trail.

n8n is the orchestration engine, not the final user interface. A dedicated web
application will provide the business dashboard.

## Architecture

```text
Business owner
  -> Agent Operations Dashboard
  -> Application API
  -> PostgreSQL system of record
       <- n8n agent workflows
            -> Gemma
            -> Postiz
            -> GoHighLevel
```

Agents communicate through durable database records and events. They do not
depend on hidden in-memory state or direct workflow-to-workflow coupling.

## Phase 0 — Engineering foundation

- Repository conventions, architecture decisions, environments, and CI
- Secret-free configuration contract
- Local developer bootstrap
- Definition of done and acceptance evidence format

**Gate:** clean setup succeeds from documented instructions and no secret is
required to run tests.

## Phase 1 — Shared data and audit foundation

- Versioned PostgreSQL migrations
- Campaign, strategy, content, post, lead, sales, job, approval, template,
  notification, and audit models
- Status constraints and transition rules
- Idempotency keys and external-operation ledger
- Seeded staging campaign and database tests

**Gate:** migrations apply from empty state, constraints reject invalid
transitions, and all meaningful actions can be correlated through the audit
model.

## Phase 2 — Agent Operations Dashboard

- Authenticated application shell
- Executive dashboard and campaign workspace
- Agent roster with live state and current job
- Approval inbox and decision history
- Activity timeline, publishing calendar, lead pipeline, reporting, and health
- Responsive, accessible design system

**Gate:** a user can operate a seeded campaign from strategy review through
content approval without entering n8n.

## Phase 3 — Strategist and Content Producer

- Structured Gemma calls with schema validation
- Missing-information blocking
- Strategy persistence and event emission
- Content generation by channel and pillar
- Rejection feedback and controlled regeneration
- Error workflows, retries, and audit evidence

**Gate:** brief -> strategy -> drafts -> human decision works end to end, and no
content can self-approve or publish.

## Phase 4 — Publisher and Performance Monitor

- Postiz credential and staging-account integration
- Approval guard immediately before every publish call
- Scheduling, idempotency, rate-limit handling, and retries
- Performance synchronization and attributable lead capture

**Gate:** only approved staging content publishes, retries cannot duplicate a
post, and every lead traces to a campaign and source post.

## Phase 5 — Sales and CRM Agent

- GoHighLevel contact upsert
- Approved template and sequence library
- Bounded outreach, follow-up, classification, and handoff
- Won/lost/nurture handling and requeue eligibility
- Revenue and weekly pipeline reporting

Phase 5E foundation implements governed message, qualification, tag,
assignment, appointment, opportunity, nurture, won, and lost action contracts;
manual/shadow/assisted/bounded-autonomous policy; consent, DND, quiet-hour,
frequency, ownership, emergency, idempotency, and indeterminate-operation
guards; and an inactive private-gateway n8n worker. Production activation and
live customer-provider acceptance remain gated.

CI also runs a secret-free disposable lifecycle through the inactive n8n action
worker and simulated provider, emitting timestamped evidence from inbound
question through grounded reply, hot qualification, appointment, and
opportunity update.

Phase 5F capacity foundation adds deterministic urgent/interactive/background
priority, organization concurrency and per-minute claim limits, automatic
Gemma/GHL cooldown recovery, capacity status/alert contracts, and a disposable
10,000-event drain with throughput, latency, outcome, isolation, recovery, and
disk-growth evidence. This measured test envelope is not a production SLA;
shared-GPU/SmartLabs and customer-provider benchmarks remain separately gated.

The follow-on resilience gate adds a disposable campaign burst, timed soak with
synthetic model latency, hot-inbound priority, dependency cooldown recovery,
worker lease recovery, PostgreSQL pool reconnect, encrypted backup/restore
under backlog, and same-job dead-letter replay. Real Redis/n8n restarts,
provider quota headers, production alert delivery, and any SmartLabs-adjacent
benchmark remain controlled future gates.

Pinned disposable n8n queue-mode recovery now covers an abrupt worker kill,
the resulting terminal n8n execution plus successful logical-correlation replay,
a graceful Redis AOF restart with queued work, readiness/metrics checks, and
local degraded/recovered alert delivery.
The installed canary, production notification destination, real provider
headers, sudden Redis host loss, and SmartLabs/GPU remain separately gated.

Disposable retention evidence now measures n8n execution/PostgreSQL and Redis
queue/AOF growth, built-in count pruning, ordinary vacuum, safe AOF compaction,
and encrypted pre-prune restoration. The proposed seven-day/10,000-execution
policy remains unapplied; representative production payload measurement and a
separately approved server transaction are still required.

Sudden dependency-loss evidence now accepts two durable synthetic batches with
the n8n worker stopped, kills Redis and PostgreSQL independently with
`SIGKILL`, and proves all 40 logical correlations recover exactly once after
AOF/WAL recovery. An independent dependency observer is required because n8n
main readiness did not report the tested Redis outage. The gate is disposable
and makes zero provider, GPU-server, production, or SmartLabs contact.

The credential-independent monitoring slice adds an authenticated organization
snapshot for queue capacity, dependency evidence, agent heartbeats, unread
alerts, and delivery readiness. Owners can configure encrypted email, Slack,
or WhatsApp alert destinations without exposing values after save. Notification
delivery remains platform-disabled and emergency-stopped; saving a destination
does not call a provider or authorize production activation.

Phase 5G begins with a customer-visible Quality & Rollout control center. It
keeps the organization at a human-baseline evidence gate, compares the latest
human, shadow, assisted, and bounded-autonomous cohorts without fixture data,
and requires sequential owner-approved promotion decisions. Evaluation
snapshots and decisions are append-only and version-attributed. A quality-stage
decision cannot activate n8n, clear an emergency stop, or call a provider.

**Gate:** test leads complete the CRM lifecycle with a timestamped explanation of
every message and state transition.

## Phase 6 — Acceptance and recovery

- Full staged campaign dry run
- Failure injection, retry, concurrency, and duplicate-delivery tests
- Security audit, egress validation, backup, disposable restoration, and rollback
- Operator runbooks and acceptance evidence

**Gate:** recovery is proven and no test can reach production accounts, real
leads, or advertising spend.

## Phase 7 — Public product delivery

- Product domain and HTTPS
- Secure dashboard authentication and session controls
- Restricted webhook ingress
- Monitoring, alerts, encrypted off-server backups, and restoration schedule
- Production readiness review and controlled launch

**Gate:** provide a working HTTPS product link only after security, recovery,
approval enforcement, and staging acceptance all pass.

## External inputs requested only when their phase needs them

- Product name, logo, colors, and tone before final Phase 2 visual polish
- Domain/subdomain before Phase 7
- Postiz credentials and social channels before Phase 4 integration testing
- GoHighLevel credentials before Phase 5 integration testing
- Approved sales templates before outreach is enabled
- Notification destination before production alerting

## Global definition of done

A feature is done only when its code, migration or workflow, automated tests,
operator documentation, audit behavior, security implications, and rollback
path are all reviewed.
