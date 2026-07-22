# Controlled Conversation Intelligence schema hotfix

## Incident and correction

The first production shadow canary reached Gemma but the model server rejected
the structured-output grammar with `Unimplemented keys: ["uniqueItems"]`.
The canary's automatic quarantine restored the workflow inactive, restored the
global GHL stop, deactivated the synthetic organization and owner, erased its
fake credential envelope, and recorded zero external actions.

The target workflow omits only `uniqueItems` from the model-server grammar.
Its local n8n validator still uses `Set` cardinality checks for both risk
categories and summary event IDs, and the authoritative database constraints
remain unchanged.

## Environment

```sh
export TANAGHOM_CONVERSATION_HOTFIX_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_CONVERSATION_HOTFIX_ID='conversation-schema-hotfix-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='a25a24d2cb4cb8a8f2a231fb1d25ed682bf5f341'
export TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT='<approved merged commit>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5c-worker'
```

## Read-only preflight

```sh
sudo -E deployment/phase6-conversation-schema-hotfix/scripts/preflight.sh
```

Preflight proves migration 0025, provider stops, the exact old workflow hash,
inactive/disabled runtime state, zero stored executions, reviewed credentials,
the reviewed target hash, and every protected boundary without changing state.

## Controlled inactive import

```sh
sudo -E deployment/phase6-conversation-schema-hotfix/scripts/deploy-update.sh
```

The command captures all workflows, credentials, active/execution counts,
container identities, the dashboard identity, production worktree, firewall,
Nginx hash, and n8n audit. It imports only the corrected workflow with
`activeState=false`, validates every other workflow unchanged, and rolls back
automatically if validation fails.

## Exact rollback before use

```sh
export TANAGHOM_CONVERSATION_HOTFIX_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-CONVERSATION-SCHEMA-HOTFIX'
sudo -E deployment/phase6-conversation-schema-hotfix/scripts/rollback-update.sh
```

Rollback restores the captured original workflow inactive. It refuses when the
stored execution count differs from the pre-hotfix count. After a canary retry,
rollback requires a separate evidence review.

## Success

- corrected workflow matches the approved operational hash and stays inactive;
- `uniqueItems` is absent from the Gemma request grammar;
- local uniqueness enforcement remains present;
- all other workflows, credentials, provider stops, database state, dashboard,
  Nginx, firewall, containers, and protected services are unchanged.

After success, rerun the separate Conversation Intelligence shadow canary with
a new unique canary ID. No customer credential or outbound action is involved.
