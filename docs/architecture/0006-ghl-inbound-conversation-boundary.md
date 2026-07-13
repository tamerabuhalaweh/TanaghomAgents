# 0006 — Signed GHL inbound conversation boundary

## Decision

Phase 5B accepts a deliberately small set of GoHighLevel webhook events through
`POST /api/webhooks/ghl`. The handler reads the exact request bytes, verifies
the current `X-GHL-Signature` Ed25519 signature, and only then parses and
normalizes the body. The implementation follows HighLevel's current public-key
and raw-body verification guidance:

- <https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/>
- <https://marketplace.gohighlevel.com/docs/webhook/InboundMessage/>

The public route is an ingress adapter, not an agent runtime. It performs no
Gemma request, n8n execution, GHL API call, message send, appointment booking,
or opportunity update. A successful request commits one normalized event and
one metadata-only `conversation.ghl.inbound_event` job before returning.

## Supported v1 events

- `InboundMessage`
- `OutboundMessage`
- `ContactCreate`
- `ContactUpdate`
- `ContactDndUpdate`
- `ConversationUnreadWebhook`

Unsupported authenticated events are acknowledged as ignored so they do not
create a provider retry storm. Unknown or ambiguous GHL location IDs also fail
closed without disclosing organization data.

## Authentication and data handling

- Ed25519 verification uses the raw bytes and base64 `X-GHL-Signature`.
- The official current GHL public key is the source default; a documented
  `GHL_WEBHOOK_PUBLIC_KEY_PEM` override supports future public-key rotation.
- The request limit is 256 KiB before normalization.
- Provider payloads are reduced to bounded identifiers, message fields,
  contact fields, status, DND data, tags, and attachment references.
- Unknown keys, credential-like DND keys, and unbounded structures are not
  persisted.
- Missing provider webhook IDs fall back to the raw-body SHA-256, preserving
  exact-delivery idempotency for older payload shapes.
- Rejected requests store only minute-bucketed counts and the latest body hash;
  invalid raw bodies and signatures are never stored.

## Durable queue and replay

The event row is the durable inbox record. An associated agent job is the
single downstream claim. A unique provider-location/event boundary and a
unique job/event boundary ensure duplicate deliveries cannot duplicate work.

`tanaghom_conversation_worker` is a dedicated NOLOGIN role. It has no direct
table or credential access and may only execute four controlled functions:

- claim one eligible event;
- complete it with a zero-external-action v1 result;
- record a bounded failure;
- recover a stale worker claim.

Retry exhaustion moves the event to `dead_letter`. An accepted owner/operator
may replay that same event and same job; replay never creates a second logical
event or job.

## Pause and emergency semantics

Authenticated messages are preserved even while processing is paused. Claims
require both organization `shadow` mode and a clear GHL platform emergency
stop. The migration defaults every organization to `paused`, and the existing
GHL emergency stop remains active by default.

This distinction prevents the loss of customer messages during an incident
while guaranteeing that no agent processes them until the runtime is approved.

## Capacity statement

The customer normally expects campaigns materially below 10,000 leads. The CI
load profile sends 10,000 synthetic signed message events and publishes event
count, downstream-job count, throughput, p50/p95/p99 acknowledgement latency,
queue depth, duplicates, dead letters, and queue age as a build artifact.

This is evidence for the tested environment, not a fixed 75,000-lead SLA.

## Network boundary

The route performs only a PostgreSQL call through the existing dashboard
database path. It adds no egress destination and no route to n8n, Gemma,
SmartLabs containers, protected host ports, or the real-time voice path.

## Activation boundary

`GHL_WEBHOOK_INGRESS_ENABLED` defaults to `false`, the canary Compose file pins
it to `false`, and this change does not configure a webhook in GHL. Production
activation requires a separately approved migration/backup, nginx rate limit,
environment diff, GHL event subscription, canary, validation, and rollback.
