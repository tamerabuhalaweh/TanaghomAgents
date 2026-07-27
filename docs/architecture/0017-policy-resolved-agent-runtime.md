# ADR 0017: Shared policy-resolved agent and Skill runtime

Status: accepted for Phase 7D repository implementation under Issue #135.
Production migration, n8n import or activation, runtime credentials, Gemma
traffic, provider traffic, and customer data execution remain separately
authorized operations.

## Decision

Tanaghom runs organization-created agents through one reviewed, multi-tenant
runtime. Creating an agent does not create a new n8n workflow. A durable job
pins an organization, immutable agent version, immutable runtime profile,
request fingerprint, language, channel, consent evidence, correlation ID, and
idempotency key.

The shared runner resolves the exact agent version, policy, knowledge keys,
assigned Skill versions, model and parser versions, limits, and integration
requirements at claim time. It gives the planner only a compact catalog of
assigned Skills. Full Skill instructions and references are disclosed on
demand for the selected, assigned Skill.

The planner returns a strict `phase7.agent-runtime-plan.v1` object. It is not an
authorization decision. Every proposed invocation is independently authorized
in PostgreSQL against:

- tenant and immutable-version bindings;
- agent and Skill lifecycle;
- exact assigned Skill, operation, record type, and channel;
- consent, mode, time, rate, concurrency, action, follow-up, token, and budget
  limits;
- customer integration health and platform/provider emergency stops;
- a parameter-bound human approval for external writes;
- a database-computed parameter hash and idempotency key; and
- active indeterminate-provider blocks.

Denied model-selected tools are recorded as refusals. They never reach an
executor.

## Instruction and trust hierarchy

The fixed hierarchy is platform safety, organization policy, immutable agent
version, disclosed assigned-Skill instructions, then untrusted user input and
retrieved content. Model output, user content, provider content, and MCP output
remain data. None can grant a permission, select an unreviewed executor, expose
a credential, change a policy, or clear an emergency stop.

The vLLM planner schema contains no unconstrained object in model output.
`arguments_json` is bounded JSON text and is reparsed and checked by both n8n
and PostgreSQL. This avoids the free-form object schema shape that previously
caused the xgrammar compiler failure.

## Execution identities

Four NOLOGIN roles divide authority:

- `tanaghom_agent_runtime` may claim jobs, resolve assigned instructions,
  record plans, request authorization, run simulations, and settle runs only
  through reviewed functions.
- `tanaghom_skill_read_executor` may claim and complete read invocations only.
- `tanaghom_skill_proposal_executor` may claim and complete proposal
  invocations only.
- `tanaghom_skill_action_executor` may claim and complete action invocations
  only after all authorization and approval checks.

None receives direct table DML. The legacy `tanaghom_n8n_worker` receives no
shared-runtime access. The current Phase 7D n8n exports use only the runtime
and simulation identities; provider executor adapters remain inactive and
require their own reviewed deployment and provider UAT.

## Evidence, failure, and recovery

Jobs, runs, invocations, approvals, dependency blocks, and runtime events are
durable and tenant-bound. Event, approval, profile, and certification evidence
is append-only. PostgreSQL computes request, plan, and parameter hashes so an
orchestrator cannot substitute its own digest.

Agent-to-agent work can be queued only by the runtime-specific handoff
function after a successful parent job. It preserves the original correlation
and human requester, targets a different enabled agent in the same tenant, and
records a versioned `phase7.agent-handoff.v1` envelope with a
database-computed attestation. Dashboard/API callers cannot forge an
`agent_handoff` source, and runtime identities have no direct table writes.

An indeterminate action-provider result creates an organization dependency
block before more work can be claimed. Only an accepted active owner can
reconcile it with bounded evidence. Retried logical operations reuse their
idempotency key and cannot create a second invocation with different
parameters.

The global runtime emergency stop defaults to active. Both n8n exports are
inactive, their polling trigger is disabled, successful and failed execution
payload retention is disabled, and the only subworkflow target is the fixed
reviewed simulation dispatcher.

## Certification and promotion

Every selected language has mandatory success, refusal, escalation,
prompt-injection, provider-failure, duplicate-retry, and emergency-stop
scenarios. Passing evidence is stored on runtime jobs; Agent Studio scenario
definitions remain immutable.

An exact validated runtime profile and complete passing scenario evidence are
required to create an immutable certification. An owner may then promote the
exact agent version only into `simulation`. Shadow, assisted, active, provider
activation, and scheduled polling still require separately reviewed rollout
gates.

## Rollback

Migration `0030_policy_resolved_agent_runtime` rolls back only while no
certification, job, run, invocation, approval, dependency block, or event
evidence exists. Once evidence exists, rollback deliberately refuses. Recovery
must use a reviewed forward migration so customer work and audit history are
never erased to force a downgrade.
