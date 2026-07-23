# Phase 7A+7B production baseline bridge and Skill Library update

Status: prepared for review only. **No deployment is authorized by this document
or by merging its pull request.**

The live read-only preflight on 2026-07-23 found production at
`0025_runtime_agent_reconciliation`, while the merged Phase 7B package requires
`0026_skill_registry`. This corrective package performs one controlled
Tanaghom-only transaction:

1. verify the exact 0025 database and current dashboard baseline;
2. check out only the separately approved target commit;
3. apply exactly `0026_skill_registry`;
4. apply exactly `0027_governed_skill_library`;
5. build and recreate only the Tanaghom dashboard; and
6. validate the exact registries, public authentication boundary, database
   health, policies, and protected-service invariants.

It does not import, edit, activate, or execute n8n workflows; call Gemma,
Postiz, GHL, MCP, or notification providers; change credentials, policies,
firewall, Nginx, Compose networks, or the tolerated Squid configuration; or
operate on SmartLabs, SmartCC, voice, Gemma, or protected n8n containers.

## Proven live baseline

- production commit:
  `a25a24d2cb4cb8a8f2a231fb1d25ed682bf5f341`;
- latest database migration: `0025_runtime_agent_reconciliation`;
- no platform Skill Registry or organization Skill Library tables;
- provider emergency stops active, Postiz and CRM manual, conversations paused;
- zero external provider operations;
- all protected units and n8n containers healthy;
- public dashboard health 200 and the not-yet-deployed Skill API 404;
- only the pre-existing reviewed
  `deployment/phase4-postiz-activation/egress/squid.conf` worktree modification;
- 24 GiB free on `/`, above the 20 GiB release floor.

Reconfirm every value. Never edit a check to make a mismatch pass.

## Why the package has no off-server backup gate

No off-server backup is required for this bounded bridge. Migration 0026 adds
only eight immutable platform Skill definitions/versions/bindings, 24 reviewed
references, and eight migration audits. Migration 0027 starts with four empty
organization tables. Both down migrations refuse changed or customer-owned
state. The transaction records exact migration checksums, an applied ledger,
the previous dashboard image, Git commit, protected container identities,
firewall state, Nginx checksum, and Squid checksum, then automatically restores
only package-owned changes on any pre-commit failure.

If any Skill or binding data changes after release, manual rollback refuses.
Preserve data and prepare a forward recovery migration; never delete records to
force a downgrade.

## 1. Review-only validation

```sh
deployment/phase7ab-skill-library-production-update/scripts/validate-package.sh
deployment/phase7ab-skill-library-production-update/scripts/test-disposable-lifecycle.sh "$DATABASE_TEST_URL"
```

The disposable test proves:

- 0026 and 0027 apply in exact order from 0025;
- the reviewed platform registry and empty organization library are exact;
- customer Skill data blocks 0027 rollback;
- changed platform Skill data blocks 0026 rollback;
- an empty reviewed release rolls back to 0025 without changing existing agent
  registries; and
- both migrations reapply cleanly.

## 2. Prepare a separate reviewed release checkout

After the corrective PR is merged, prepare a clean release source without
changing `/opt/tanaghom-dashboard`:

```sh
git clone --no-checkout \
  https://github.com/tamerabuhalaweh/TanaghomAgents.git \
  /opt/tanaghom-release-phase7ab
git -C /opt/tanaghom-release-phase7ab fetch --no-tags origin main
git -C /opt/tanaghom-release-phase7ab checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-phase7ab status --porcelain
```

The target must be the current remote `main`, descend from the proven
production commit, and contain no change to the tolerated Squid file.

## 3. Set exact reviewed identities

Use an interactive root shell only after Tamer approves the merged corrective
package and its expanded 0026+0027 production scope:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase7ab-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='a25a24d2cb4cb8a8f2a231fb1d25ed682bf5f341'
export TANAGHOM_TARGET_COMMIT='<APPROVED_40_CHARACTER_MAIN_SHA>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase7ab'
```

## 4. Run the read-only preflight

```sh
/opt/tanaghom-release-phase7ab/deployment/phase7ab-skill-library-production-update/scripts/preflight.sh
```

Preflight refuses:

- absent authorization or malformed release identities;
- dirty/mismatched release source;
- any production change other than the exact tolerated Squid file;
- remote-main, ancestry, or Squid-path drift;
- any migration other than 0025 or any pre-existing Skill table;
- unlocked policy or any external provider operation;
- missing/unsafe secret metadata;
- less than 20 GiB free;
- unhealthy dashboard/protected service/container;
- missing approved firewall boundary;
- public login/root/API/n8n boundary drift.

Stop on any refusal.

## 5. Controlled update

After the expanded deployment scope is separately approved:

```sh
/opt/tanaghom-release-phase7ab/deployment/phase7ab-skill-library-production-update/scripts/deploy-update.sh
```

The script re-runs preflight, creates root-only evidence, tags the current
dashboard image, fetches and verifies the exact authorized target into the
production Git object store, checks out that target, applies 0026 then 0027
with predecessor checks and an applied ledger, builds/recreates only
`dashboard`, waits for health, and validates:

- exactly eight reviewed platform Skills and exact immutable evidence;
- zero organization Skills and zero organization agent bindings;
- dashboard read-only access and no direct Skill DML;
- no Skill table access for n8n or conversation workers;
- unchanged provider/notification emergency controls and zero operations;
- unchanged protected n8n container identities;
- unchanged package-owned firewall rules, Nginx config, and Squid config;
- public Skill page 307, Skill API 401, login 200, health/database connected;
- public n8n TCP 5678 remains unreachable.

Any failure before `COMMITTED_AT` restores the recorded production commit and
dashboard image, then reverses only ledger-recorded migrations when their
data-preservation guards still pass.

## 6. Exact rollback

Rollback is allowed only while both registries still match the reviewed,
empty-customer release:

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE'
/opt/tanaghom-release-phase7ab/deployment/phase7ab-skill-library-production-update/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

It restores the recorded commit and dashboard image, reverses 0027 then 0026,
and verifies the exact 0025/public/protected baseline. It never truncates data.

## 7. Cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

Keep the evidence directory and rollback image until retention is separately
approved.
