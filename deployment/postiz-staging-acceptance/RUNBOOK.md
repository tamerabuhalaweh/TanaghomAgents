# Postiz staging acceptance kit (#45)

Purpose: earn the scorecard gate **"Postiz staging acceptance #45"** with
current-release evidence: one mapped supported channel, exactly one Postiz
**draft**, a replay that creates no duplicate, and no publication.

This kit is run by an authorized Tanaghom operator on a **staging/test
deployment with a Postiz test workspace and one test channel**. It is not run by
the source PR. Nothing here publishes: the request type is always `draft`,
never `now` or `schedule`, and since `readiness/05-postiz-draft-kit` the gateway
rejects any other type with `422 postiz_publish_type_forbidden` before it reads
credentials or calls Postiz.

## Inputs the team supplies

| Input | Where it goes | Never |
| --- | --- | --- |
| Postiz test workspace API key | Settings → Integrations → Postiz (encrypted vault) | Git, chat, evidence |
| One supported test channel (e.g. a private Instagram/LinkedIn test page) | Mapped in Settings → Publishing channels | A customer channel |
| Release commit (40-char SHA) and owner name | `RELEASE_COMMIT`, `EVIDENCE_OWNER` | — |
| Read-only database URL (`tanaghom_readonly`) | Shell env only, for step 8 | `.env` committed |

## Preconditions (stop if any fails)

1. Exact release commit deployed and recorded; migrations at the expected level.
2. `phase4PostizDraftV1` imported **inactive**; its schedule trigger stays disabled.
3. `tanaghom.automation_platform_controls` Postiz row shows `emergency_stop=true`.
4. No Postiz `external_operations` row is `indeterminate`.
5. Backup taken per the deployment package for this host.

## Steps

1. Sign in as owner. Settings → Integrations → Postiz: save the test API key,
   run **Test connection**, confirm the discovered test channel.
2. Map exactly one supported channel. Record its provider integration id (not a secret).
3. Create a campaign with one content item for that channel, then **approve** it
   in Approvals as a human reviewer. Record the content item id.
4. Set the organization Postiz draft mode to `manual`.
5. An authorized operator lifts the Postiz platform **emergency stop** for this
   window only and records actor, time and reason in the audit log.
6. From the approved item, request the Postiz draft handoff once. Run the
   inactive workflow **once** with `n8n execute --id=phase4PostizDraftV1`.
   Confirm in the Postiz UI that the item exists as a **draft** on the test channel.
7. Replay: request the handoff again and run the workflow a second time. Expected:
   the same job id is returned, the second run claims nothing and makes **zero**
   Postiz requests, and Postiz still shows one draft.
8. Restore the **emergency stop** (`emergency_stop=true`) and set draft mode back
   to its previous value. Then collect read-only evidence:

   ```sh
   DATABASE_URL='<read-only role URL>' CONTENT_ITEM_ID=<uuid> \
   RELEASE_COMMIT=<sha> EVIDENCE_OWNER='<name>' \
   node scripts/postiz-staging-evidence.mjs --out=docs/evidence/<date>-postiz-staging.md
   ```

   Exit code `0` means every check passed; `1` means no scorecard credit.
9. Attach secret-free screenshots: Postiz draft view, mapped channel name, the
   second n8n execution output. Delete the test draft in Postiz if the team wishes.
10. Update `docs/PRODUCTION_READINESS.md` gate #45 to 5/5 with date, release,
    command result and owner, and link the evidence file. Reviewer signs off in the PR.

## Checks the evidence script makes

`human_approval_recorded`, `exactly_one_provider_draft`,
`no_publication_or_schedule`, `exactly_one_external_operation`,
`replay_created_no_duplicate_job`, `no_indeterminate_postiz_operation`,
`postiz_emergency_stop_restored`. It runs inside a `READ ONLY` transaction and
makes no provider call.

## Failure and rollback

- Any non-`draft` request, duplicate draft, scheduled/live post or indeterminate
  operation: restore the emergency stop immediately, do not retry, and open an
  incident on #45 with the evidence output.
- Rollback of this source change: revert the PR; the gateway returns to its
  previous behaviour (the database still builds `type: draft` only). No
  migration or data change is involved.
