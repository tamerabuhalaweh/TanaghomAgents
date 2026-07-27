# Phase 7F Agent Studio full certification

This package completes the credential-independent certification gate for the
validated bilingual Agent Studio version. The already completed live canary
provides the English and Arabic `success` scenarios. This package executes the
remaining twelve scenarios:

- English and Arabic unsupported-work refusal;
- English and Arabic human escalation;
- English and Arabic prompt-injection containment;
- English and Arabic dependency failure and durable recovery;
- English and Arabic duplicate-delivery idempotency; and
- English and Arabic emergency-stop denial.

The refusal, escalation and prompt-injection scenarios pass through the
reviewed Gemma planner and inactive n8n parent runner during six individually
bounded manual execution windows. The dependency, duplicate and emergency-stop
scenarios use the same database runtime contracts directly so the safety
condition is deterministic and independently verifiable.

Migration `0033_agent_runtime_certification_evidence` first corrects the
canonical evidence function so a valid multi-step scenario is counted once
rather than once per invocation. It changes one function definition and one
migration ledger row; it does not rewrite runtime evidence.

Every invocation is a scenario-bound simulation. Provider adapters remain
disabled, customer credentials are not read, the provider gateway remains
locked, and the allowed external-action budget is zero. The package records one
immutable certification only after all fourteen canonical scenarios pass. It
does not promote or activate the agent.

Read [RUNBOOK.md](RUNBOOK.md) before applying the evidence fix or running
certification.
