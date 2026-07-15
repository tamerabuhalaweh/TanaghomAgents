# Phase 5D transactional production update

> **Superseded and execution-disabled.** The live production database is at migration 0009, but the current dashboard target requires migration 0019. This older package would stop at 0014 and rebuild an incompatible dashboard. Use `deployment/phase5f-database-bridge` instead; its preflight applies 0010-0014 without changing the running dashboard.

## Status and authorization boundary

This package updates an existing public Tanaghom dashboard from migration
`0009` through `0014`. It is manually executed and is not GitHub Actions CD.
CI may parse and test this package but may never connect to production.

Merging the package does **not** authorize production execution. A separate
owner approval must name the exact full current commit, exact full target
commit, release ID, backup proof, deployment diff, and rollback procedure.

The package never activates GHL ingress, n8n polling, provider messaging, AI
lease claims, alert sweeping, Postiz publishing, or any mass outbound path.
It never changes SmartLabs, voice-agent, Gemma, n8n, Postiz, unrelated Nginx
configuration, or `/data`.

## Expected resource use

- Root filesystem gate: at least 20 GiB available before execution.
- Current audit: approximately 35 GiB available.
- Database backup: the live database is approximately 13 MiB before migration;
  retain at least 1 GiB off-server for archive, restoration, and evidence.
- Dashboard build: reserve up to 8 GiB temporary Docker layer headroom.
- Release evidence and rollback metadata: under 100 MiB, excluding Docker image
  layers and the encrypted off-server database archive.

The mounted 500 GB `/data` drive is intentionally unused.

## 1. Prepare the reviewed release identity

After the PR is merged, record full 40-character SHAs:

```powershell
git -C C:\Users\tamer\Desktop\Groky\TanaghomAgents pull --ff-only
git -C C:\Users\tamer\Desktop\Groky\TanaghomAgents rev-parse HEAD
```

Choose a unique UTC release ID:

```powershell
$ReleaseId = "phase5d-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
```

The separately approved deployment authorization must state:

- `TANAGHOM_EXPECTED_CURRENT_COMMIT` — the exact live commit;
- `TANAGHOM_TARGET_COMMIT` — the exact merged target;
- `TANAGHOM_RELEASE_ID` — the unique transaction;
- migration range `0009` to `0014`; and
- that production execution, not only package review, is authorized.

## 2. Encrypted off-server backup and real restoration

Run on the Windows operator workstation, outside the GPU server. Load the
ignored `.env` without printing it, then execute:

```powershell
Set-Location C:\Users\tamer\Desktop\Groky\TanaghomAgents
$line = Get-Content .env | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
$env:DATABASE_URL = $line.Substring('DATABASE_URL='.Length)
./deployment/phase5d-production-update/scripts/prepare-offserver-backup.ps1 `
  -ReleaseId $ReleaseId `
  -OutputRoot C:\Users\tamer\Desktop\Groky\backups
Remove-Item Env:DATABASE_URL
```

The script creates an encrypted 7z archive, SHA-256 checksum, Windows
DPAPI-protected recovery key, and `backup-proof.env`. It restores the dump into
a uniquely named disposable container using a pinned PostgreSQL image and
verifies the migration ledger and Tanaghom schema. Only `backup-proof.env` is
copied to the server staging directory. Keep the encrypted archive and DPAPI
key off-server for 30 days; perform another restoration test before deletion.

CI separately creates an encrypted disposable archive and performs an actual
restore with `scripts/test-disposable-backup.sh`. It uses only the CI database
and cannot connect to production.

## 3. Stage without changing production

Clone the exact target into a new administrator-owned staging directory and
copy the non-secret proof. Do not change `/opt/tanaghom-dashboard` yet.

```sh
git clone https://github.com/tamerabuhalaweh/TanaghomAgents.git \
  "/home/administrator/tanaghom-$TANAGHOM_RELEASE_ID-stage"
git -C "/home/administrator/tanaghom-$TANAGHOM_RELEASE_ID-stage" \
  checkout --detach "$TANAGHOM_TARGET_COMMIT"
git -C "/home/administrator/tanaghom-$TANAGHOM_RELEASE_ID-stage" \
  status --porcelain
```

Place `backup-proof.env` outside the clean Git checkout at
`/home/administrator/tanaghom-$TANAGHOM_RELEASE_ID-backup-proof.env` with mode
`0600`. Do not copy `.env`, database URLs, API keys, or recovery material.

## 4. Privileged preflight

Open an interactive SSH session so the password is never embedded in a command
or file. Authenticate sudo once:

```sh
ssh -t administrator@38.247.187.232
sudo -v
```

Set only non-secret release metadata:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER
export TANAGHOM_RELEASE_ID='phase5d-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='FULL_CURRENT_SHA'
export TANAGHOM_TARGET_COMMIT='FULL_TARGET_SHA'
export TANAGHOM_RELEASE_SOURCE_ROOT="/home/administrator/tanaghom-$TANAGHOM_RELEASE_ID-stage"
export TANAGHOM_BACKUP_PROOF="/home/administrator/tanaghom-$TANAGHOM_RELEASE_ID-backup-proof.env"
sudo --preserve-env=TANAGHOM_RELEASE_AUTHORIZATION,TANAGHOM_RELEASE_ID,TANAGHOM_EXPECTED_CURRENT_COMMIT,TANAGHOM_TARGET_COMMIT,TANAGHOM_RELEASE_SOURCE_ROOT,TANAGHOM_BACKUP_PROOF \
  "$TANAGHOM_RELEASE_SOURCE_ROOT/deployment/phase5d-production-update/scripts/preflight.sh"
```

Preflight is read-only. It refuses unexpected Git state, migration state,
storage, secret metadata, Compose shape, public boundaries, firewall state,
emergency controls, protected unit state, protected n8n container health, or
backup proof.

## 5. Execute the transaction

Only after the preflight evidence and exact target are approved:

```sh
sudo --preserve-env=TANAGHOM_RELEASE_AUTHORIZATION,TANAGHOM_RELEASE_ID,TANAGHOM_EXPECTED_CURRENT_COMMIT,TANAGHOM_TARGET_COMMIT,TANAGHOM_RELEASE_SOURCE_ROOT,TANAGHOM_BACKUP_PROOF \
  "$TANAGHOM_RELEASE_SOURCE_ROOT/deployment/phase5d-production-update/scripts/deploy-update.sh"
```

The transaction:

1. repeats preflight;
2. creates a unique root-only evidence directory;
3. records protected n8n container IDs and the previous dashboard image;
4. creates an immutable rollback image tag;
5. checks out only the approved target;
6. applies exactly migrations `0010` through `0014` with predecessor checks;
7. builds and recreates only the dashboard with the existing public overlay;
8. proves health, authorization boundaries, locked policies, least privilege,
   zero external operations, unchanged firewall, unchanged protected services,
   and unchanged n8n container IDs; and
9. commits evidence only after every gate passes.

Any failure before commit invokes automatic rollback of the source, dashboard
image, and only migrations recorded by this transaction.

## 6. Browser and synthetic acceptance

With all provider paths still disabled, use an owner account to validate:

- Supervisor Inbox desktop and mobile layout;
- Arabic RTL conversation presentation;
- owner/operator/reviewer/viewer permissions;
- loading, empty, stale, offline, forbidden, and error states;
- one synthetic `.test` conversation through takeover, assignment, pause,
  explicit AI return, human reply draft, and resolve; and
- the visible statement that the reply draft sent nothing to GHL.

Afterwards verify `tanaghom.external_operations` remains zero. Do not activate
GHL ingress, an n8n schedule, an AI lease claimant, or a provider send path.

## 7. Exact controlled rollback

Rollback requires a second explicit authorization and the original staging
checkout because it contains the reviewed down migrations:

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION=ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE
sudo --preserve-env=TANAGHOM_RELEASE_AUTHORIZATION,TANAGHOM_ROLLBACK_AUTHORIZATION,TANAGHOM_RELEASE_ID,TANAGHOM_EXPECTED_CURRENT_COMMIT,TANAGHOM_TARGET_COMMIT,TANAGHOM_RELEASE_SOURCE_ROOT,TANAGHOM_BACKUP_PROOF \
  "$TANAGHOM_RELEASE_SOURCE_ROOT/deployment/phase5d-production-update/scripts/rollback-update.sh"
```

Rollback refuses missing evidence, changed protected containers, inactive
emergency stops, external operations, an unexpected source revision, an
unexpected migration ledger, or a missing rollback image. It restores the
recorded dashboard/source first, then reverses only migrations listed in the
transaction evidence until `0009` is reached. It never blindly runs a fixed
number of rollbacks.

Restore the encrypted database backup only if controlled rollback fails or a
separate data-reconciliation review requires it. Database restoration is never
automatic.

## Production authorization

Production execution remains unauthorized until Tamer approves the merged
target SHA, release ID, off-server restore proof, privileged preflight output,
deployment command, and rollback command.
