# Controlled Conversation Intelligence shadow-canary runbook

## Purpose and safety boundary

The canary proves that the deployed Conversation Intelligence worker can use
approved Tanaghom knowledge and the reviewed Gemma endpoint to create one cited,
proposal-only answer visible in the Supervisor Inbox. It does not test or
authorize outbound messaging, GHL actions, customer data, polling, scheduled
automation, or broader workflow activation.

The synthetic question is: `What is the approved Tanaghom Canary Growth plan
price?` The only approved source says the price is `USD 99 per month`. Success
requires a non-escalating English proposal citing that exact active knowledge
version, a Supervisor Inbox state of `awaiting_approval`, and zero external
actions.

## Preconditions

- Issue #108 and the package PR are approved and merged.
- Production is at migration `0024_conversation_intelligence_worker_registry`.
- The Conversation Intelligence workflow matches the reviewed repository
  export, is inactive, has its polling schedule disabled, and has zero prior
  executions.
- No GHL connection, claimable/running conversation job, open inbound event,
  active dependency cooldown, external operation, or GHL action job exists.
- Every organization conversation policy is paused and emergency-stopped.
- The global GHL emergency stop is active.
- The production dashboard checkout and its one previously reviewed protected
  worktree diff are unchanged.
- All protected health, public boundaries, container identities, and firewall
  rules pass.

## Environment

Run as the authorized `administrator` account with privileged access. Do not
put secrets or passwords in shell history.

```sh
export TANAGHOM_CONVERSATION_CANARY_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_CONVERSATION_CANARY_ID='conversationcanary-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='<current deployed dashboard commit>'
export TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT='<approved merged package commit>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5c-worker'
```

The release-source checkout must be clean and exactly at the approved package
commit. The production checkout is inspected but never edited.

## Read-only preflight

```sh
sudo -E deployment/phase6-conversation-shadow-canary/scripts/preflight.sh
```

The command must print `PASS`. It performs a verifying TLS database handshake,
exports and compares n8n definitions, and changes no production state.

## Controlled execution

After reviewing the preflight result:

```sh
sudo -E deployment/phase6-conversation-shadow-canary/scripts/run-canary.sh
```

The controlled sequence is:

1. Capture protected container identities, production worktree state, firewall
   policy, n8n workflows, execution counts, provider counts, and the exact GHL
   emergency-stop reason.
2. Create a unique synthetic `.test` organization, owner, fake disconnected-
   later GHL credential envelope, approved pricing fact, inbound question, and
   exactly one queued conversation job while the global stop stays active.
3. Re-prove that this synthetic job is the only claimable GHL conversation job.
4. Set the worker registry to `active/disabled`, clear the global GHL stop only
   for this bounded run, publish the already schedule-disabled workflow, and
   execute it once from the n8n CLI.
5. Immediately unpublish and restore the reviewed inactive workflow, registry,
   and original GHL emergency-stop reason.
6. Verify one successful job/event/proposal, at least one valid active citation,
   `external_action_count=0`, and the expected Supervisor Inbox record.
7. Deactivate the synthetic owner and organization, disconnect and erase the
   fake credential envelope, pause its policies, and retain the immutable test
   proposal/audit evidence.
8. Run `n8n audit` and re-prove every protected boundary and baseline count.

Evidence is written with mode `0700/0600` under
`/var/backups/tanaghom-$TANAGHOM_CONVERSATION_CANARY_ID`.

## Automatic restoration and failure quarantine

The failure trap runs before any mutable step. It unpublishes only
`phase5ConversationIntelligenceV1`, restores only its captured original export,
returns only `conversation_intelligence_worker` to inactive/disabled, restores
the GHL platform stop, disconnects the synthetic integration, cancels only the
synthetic unfinished job, and deactivates only the synthetic user/organization.
It never deletes evidence or touches another organization.

If an operator interruption requires a manual replay of the same bounded
restoration:

```sh
sudo -E deployment/phase6-conversation-shadow-canary/scripts/restore-locks.sh \
  "/var/backups/tanaghom-$TANAGHOM_CONVERSATION_CANARY_ID"
```

The restore command is idempotent. Do not delete the evidence directory or
manually clear a platform stop.

## Success gate

The canary passes only when:

- exactly one new n8n execution exists for the worker;
- the worker definition and every non-canary workflow are unchanged and inactive;
- the global GHL stop and its original reason are restored;
- the synthetic organization is inactive, its owner inactive, and its fake
  integration disconnected with credential fields erased;
- one job and event succeeded and one grounded proposal exists;
- the proposal is English, `answer_status=proposal`, non-escalating, mentions
  `99`, cites at least one active organization knowledge version, and records
  zero external actions;
- the Supervisor Inbox contains the conversation in `awaiting_approval` with
  one `proposal_ready` ownership transition;
- no external operation, GHL action job, post, lead, or customer/provider action
  count increased;
- protected health, container identities, firewall policy, public boundaries,
  production worktree, and `n8n audit` pass.

Passing this gate completes the credential-independent runtime proof for Issue
#108. Customer GHL credentials, authenticated webhooks, live data, outbound UAT,
and any production activation remain separate approval gates.
