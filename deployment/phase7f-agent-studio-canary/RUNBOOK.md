# Controlled Phase 7F Agent Studio bilingual canary

## Purpose

This canary is the first production-shaped gate for Issue #137. It takes one
exact, already validated bilingual Agent Studio version and runs:

1. its English `success` scenario; and
2. its Arabic `success` scenario.

Both jobs use the reviewed Policy-Resolved Agent Runner and fixed Simulation
Dispatcher. The runner may call the reviewed private Gemma planner. Every
skill invocation remains `simulation_only=true`; the dispatcher records
`external_action_count=0`; all provider adapters remain disabled; and the
dashboard's provider gateway remains locked.

This is not full certification. The other twelve mandatory adversarial
scenarios remain required before a certification record or lifecycle
promotion can occur.

## Immutable safety boundary

- The parent runner remains inactive.
- The transaction replaces only the inactive Simulation Dispatcher when its
  installed trigger still uses n8n's rejected legacy empty-input shape.
- The corrected dispatcher accepts parent data through the supported
  `inputSource: passthrough` contract.
- The endpoint-free, schedule-free Simulation Dispatcher is published only
  around each parent CLI call and is immediately unpublished afterward.
- This n8n workflow publication makes the fixed child callable; it does not
  publish content or enable a social/CRM provider.
- Every schedule trigger remains disabled.
- Each runner execution uses the documented one-off
  `n8n execute --id phase7dPolicyResolvedAgentRunnerV1` command.
- The shared runtime emergency stop opens for only one queued job at a time
  and is restored immediately after the CLI process exits.
- Postiz, GHL and every provider emergency stop remain active.
- Read, proposal and action provider adapters remain disabled.
- No direct table write is granted to n8n or the dashboard API.
- No credential, secret or provider payload is written to Git.
- n8n may replace a repository credential placeholder ID with an existing
  encrypted credential ID during import. Operational hashes normalize only
  that internal ID; preflight independently proves every installed binding
  resolves to the reviewed credential name and type.
- A failure trap restores the original runtime stop and quarantines only this
  canary's unfinished jobs. It also unpublishes the Simulation Dispatcher
  whenever a failure interrupts the bounded call window. If this run installed
  the corrected dispatcher, the same trap restores the exact original export
  and verifies the complete operational workflow inventory. Completed
  evidence is never deleted.
- No service, container, firewall, Nginx configuration or protected project
  file is restarted, recreated or edited.

## Required identifiers

The operator supplies exact UUIDs already present in production:

- organization;
- accepted active owner; and
- validated bilingual Agent Studio version; and
- reviewed immutable Gemma served-model runtime profile.

The preflight proves the three identities belong together, the version has
exactly one English and one Arabic `success` scenario, no conflicting open
runtime work exists, and the canary ID has never been used.

## Read-only preflight

Run from a clean checkout at the approved merged commit:

```sh
export TANAGHOM_PHASE7F_CANARY_AUTHORIZATION='GO-INSTALL-DISPATCHER-AND-RUN-SIMULATION-ONLY-CANARY'
export TANAGHOM_PHASE7F_CANARY_ID='phase7f-canary-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='<40-character deployed SHA>'
export TANAGHOM_PHASE7F_SOURCE_COMMIT='<40-character approved merged SHA>'
export TANAGHOM_CANARY_ORGANIZATION_ID='<organization UUID>'
export TANAGHOM_CANARY_OWNER_ID='<accepted owner UUID>'
export TANAGHOM_CANARY_AGENT_VERSION_ID='<validated bilingual version UUID>'
export TANAGHOM_CANARY_RUNTIME_PROFILE_ID='7d000000-0000-4000-8000-000000000002'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase7f'

sudo -E \
  deployment/phase7f-agent-studio-canary/scripts/preflight.sh
```

Preflight is read-only and must print `PASS`.

## Controlled execution

After reviewing the preflight evidence:

```sh
sudo -E \
  deployment/phase7f-agent-studio-canary/scripts/run-canary.sh
```

The script:

1. captures the original runtime-stop reason, protected identities, firewall,
   worktree, workflow definitions and side-effect counts;
2. if required, transactionally imports only the reviewed passthrough
   Simulation Dispatcher inactive and proves every other workflow unchanged;
3. queues only the exact English and Arabic success scenarios;
4. proves those are the only claimable shared-runtime jobs;
5. temporarily publishes only the Simulation Dispatcher, opens the runtime
   stop, executes the inactive runner once, restores the stop, and immediately
   unpublishes the dispatcher;
6. verifies both workflows returned inactive, verifies the terminal
   simulation invocation, and finalizes its scenario
   evidence;
7. repeats the bounded execution for the second language;
8. proves both jobs passed with zero provider dispatches, provider references,
   external actions and cost;
9. proves the Agent Studio version remains `validated` and no certification
   was forged from this partial canary;
10. runs `n8n audit`; and
11. rechecks all protected health, workflow, firewall, worktree and public
    boundaries.

Root-only evidence is retained under:

```text
/var/backups/tanaghom-phase7f-canary-YYYYMMDDTHHMMSSZ
```

## Failure restoration

The run installs its restoration trap before queueing work. If any command
fails, it restores the original shared-runtime emergency-stop reason and marks
only this canary's unfinished invocations, runs and jobs terminal. It also
unpublishes the Simulation Dispatcher if the failure interrupted its bounded
call window. If the transaction installed the corrected dispatcher, it imports
the exact captured original inactive export and proves every workflow's
operational state was restored. It does not delete evidence or affect another
job.

The exact idempotent manual restoration is:

```sh
sudo -E \
  deployment/phase7f-agent-studio-canary/scripts/restore-locks.sh \
  "/var/backups/tanaghom-$TANAGHOM_PHASE7F_CANARY_ID"
```

## Pass gate

Success requires:

- one passed English scenario and one passed Arabic scenario;
- exactly two succeeded scenario jobs and runs;
- only simulation invocations;
- zero provider dispatches, provider references, cost and external actions;
- no certification or lifecycle promotion;
- the original runtime stop restored;
- every provider stop and adapter still locked;
- both reviewed workflows still inactive and byte-equivalent operationally;
- no non-canary workflow change;
- no protected container/service identity, firewall, Nginx or worktree change;
  and
- a passing `n8n audit`.

After this two-scenario canary, Issue #137 remains open for the complete
fourteen-scenario bilingual certification, Shadow and Assisted UAT.
