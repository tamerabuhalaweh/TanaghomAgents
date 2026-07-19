# Controlled core-agent canary runbook

## Outcome and boundary

The canary proves this customer-visible path with real Tanaghom infrastructure:

`fictional brief -> Campaign Strategist -> persisted strategy -> Content Producer -> 1-2 drafts -> authenticated human approval`

Only the two Phase 3 workflows are temporarily published, one at a time. Their
schedule nodes are disabled before publication, each workflow is executed once
from the n8n CLI, and both reviewed definitions are restored inactive before
the operator is asked to approve anything. The canary intentionally ends before
Postiz, GHL, lead creation, scheduling, publishing, messaging, or budget spend.

## Preconditions

- Issue #89 and the package PR are approved and merged.
- The GPU server dashboard checkout remains at the explicitly reviewed
  production commit; this package does not update that checkout.
- A separate clean checkout contains the merged canary source commit.
- Migration `0022_agent_registry` is current.
- Both core workflows match the repository exports and are inactive.
- No claimable strategy/content backlog and no running agent job exist.
- Postiz stays Manual, CRM/conversation automation stays locked, and provider
  emergency stops stay active.
- All protected services, n8n containers, firewall hooks, and public boundaries
  are healthy.
- The Node operator loads the reviewed Supabase root CA and completes a
  read-only TLS/database handshake before any workflow definition is changed.

No new database backup is required: the canary applies no schema change and
deletes no business record. Its append-only `.test` campaign, job, strategy,
draft, and approval evidence is deliberately retained for audit.

## Environment

Run as the authorized `administrator` account with privileged access. Do not
place credentials or passwords in shell history.

```sh
export TANAGHOM_CANARY_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_CANARY_ID='corecanary-YYYYMMDDTHHMMSSZ'
export TANAGHOM_CANARY_CAMPAIGN='Tanaghom controlled core canary YYYY-MM-DD.test'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='<current 40-character production commit>'
export TANAGHOM_CANARY_SOURCE_COMMIT='<approved merged package commit>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='<clean checkout containing the approved package>'
```

## Read-only preflight

```sh
sudo -E deployment/phase6-core-agent-canary/scripts/preflight.sh
```

The command must print `PASS` and changes no production state.

The preflight fails closed if the reviewed CA is missing, invalid, or cannot
validate the live database chain. Do not bypass this with
`NODE_TLS_REJECT_UNAUTHORIZED=0` or a non-verifying SSL mode.

## Controlled run

This is a separate authorization point after preflight review:

```sh
sudo -E deployment/phase6-core-agent-canary/scripts/run-canary.sh
```

The script performs the following transaction-like sequence:

1. Captures workflow, execution, container, firewall, and provider-side-effect baselines.
2. Creates temporary definitions with both minute schedules disabled.
3. Seeds one fictional zero-budget `.test` strategy job.
4. Publishes Campaign Strategist, executes it once, and immediately unpublishes it.
5. Queues one bounded content job from the persisted strategy.
6. Publishes Content Producer, executes it once, and immediately unpublishes it.
7. Restores both original reviewed definitions inactive and runs `n8n audit`.
8. Proves the campaign has one strategy, one or two pending drafts, and no post,
   lead, external operation, publishing job, or CRM job.

Evidence is written with mode `0700/0600` under
`/var/backups/tanaghom-$TANAGHOM_CANARY_ID`. No secrets are copied into Git.

If any step fails, the exit trap unpublishes both workflows, imports their
captured originals inactive, resets their registry state to inactive, and marks
an incomplete pre-draft test campaign failed when safe. It does not delete audit
records or customer data.

## Human approval

After a successful controlled run, Tamer signs into Tanaghom, opens the pending
content review, inspects every canary draft, and explicitly approves each one.
The automation is already inactive at this point.

Then run the separate verification:

```sh
export TANAGHOM_HUMAN_APPROVAL_VERIFICATION='YES-VERIFY-AUTHENTICATED-HUMAN-APPROVAL'
sudo -E deployment/phase6-core-agent-canary/scripts/verify-human-approval.sh
```

This command verifies approvals; it does not create them. It requires every
draft to have an approval from an active human in the campaign organization and
re-proves that no Postiz/GHL/provider action occurred.

## Exact emergency restoration

Use this if an operator interruption leaves either workflow active or its
temporary schedule-disabled definition installed:

```sh
sudo -E deployment/phase6-core-agent-canary/scripts/restore-workflows.sh \
  "/var/backups/tanaghom-$TANAGHOM_CANARY_ID"
```

The command is package-scoped: it unpublishes only `phase3StrategistV1` and
`phase3ContentProducerV1`, restores only their captured definitions, and resets
only their two registry rows. It does not restart/recreate n8n and does not
touch SmartLabs, SmartCC, voice, Gemma, Nginx, firewall rules, credentials,
Postiz, GHL, or any other workflow.

The canary's immutable business/audit evidence is intentionally not deleted.
Deletion is not part of rollback. If the test campaign must later be removed,
that requires a separately reviewed data-retention decision.

## Success gate

The canary passes only when all of these are true:

- exactly one new Strategist and one new Content Producer n8n execution exist;
- both workflows and their schedules are inactive after the run;
- every other n8n workflow, protected container identity, and firewall rule is unchanged;
- one strategy and one or two drafts exist for the unique `.test` campaign;
- an authenticated active human approves every draft through Tanaghom;
- Postiz/GHL job counts, posts, leads, and external operations do not increase;
- `n8n audit`, protected health, firewall boundary, and public health pass.

Passing this canary proves the core brief-to-approval path. It does not authorize
scheduled polling, automatic publishing, CRM actions, or broader agent activation.
