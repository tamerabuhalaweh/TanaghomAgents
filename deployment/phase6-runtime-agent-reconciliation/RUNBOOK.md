# Runtime-agent reconciliation runbook

## Outcome

Migration `0025_runtime_agent_reconciliation` adds the missing enabled
`publisher_monitor` and `sales_crm` rows while preserving the two existing core
agent rows. It refuses fixed-ID conflicts and incompatible existing semantic
rows. Its down migration deletes only unused package-created identities; an
agent with immutable job history is retained.

No production action is authorized merely by merging this package.

## Environment

```sh
export TANAGHOM_RUNTIME_AGENT_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RUNTIME_AGENT_RELEASE_ID='phase6-runtime-agents-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='a25a24d2cb4cb8a8f2a231fb1d25ed682bf5f341'
export TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT='<approved merged commit>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5c-worker'
```

## Read-only preflight

```sh
sudo -E deployment/phase6-runtime-agent-reconciliation/scripts/preflight.sh
```

Preflight requires migration 0024, exactly the two existing core runtime rows,
both target codes absent, both stable target IDs unused, all provider stops
active, no external operations, and every protected boundary healthy.

## Controlled deployment

```sh
sudo -E deployment/phase6-runtime-agent-reconciliation/scripts/deploy-update.sh
```

The package captures the agent, n8n workflow/credential, container, firewall,
Nginx, production-worktree, and provider-operation baselines. It applies only
0025 and proves that removing the two new rows from the post-state yields the
exact pre-state. A failure trap applies the guarded down migration before use.

## Exact rollback before runtime use

```sh
export TANAGHOM_RUNTIME_AGENT_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-RUNTIME-AGENT-RELEASE'
sudo -E deployment/phase6-runtime-agent-reconciliation/scripts/rollback-update.sh
```

Rollback refuses if either new agent has any job history. After the Conversation
Intelligence canary, historical `sales_crm` evidence must be preserved and this
rollback is intentionally unavailable. The migration down path itself also
retains used identities.

## Success

- latest migration is 0025;
- all four business runtime codes exist exactly once;
- the two new rows are enabled and use the reviewed identities;
- prior agents and every n8n/protected boundary are unchanged;
- no workflow, provider call, credential, dashboard, Nginx, firewall, or
  protected service was modified.

After this gate, rerun the separate Conversation Intelligence shadow canary.
