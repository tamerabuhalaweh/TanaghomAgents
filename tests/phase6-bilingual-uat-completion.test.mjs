import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "deployment", "phase6-bilingual-uat-completion");

test("bilingual UAT completion remains fail-closed and provider-free", async () => {
  const [deploy, uat, common, migration, rollback, legacyTest, runbook] = await Promise.all([
    readFile(join(packageRoot, "scripts", "deploy-correction.sh"), "utf8"),
    readFile(join(packageRoot, "scripts", "run-bilingual-uat.sh"), "utf8"),
    readFile(join(packageRoot, "scripts", "common.sh"), "utf8"),
    readFile(
      join(root, "packages", "database", "migrations", "0028_strategy_cadence_integrity.up.sql"),
      "utf8",
    ),
    readFile(
      join(root, "packages", "database", "migrations", "0028_strategy_cadence_integrity.down.sql"),
      "utf8",
    ),
    readFile(join(packageRoot, "scripts", "test-legacy-cadence-backfill.sh"), "utf8"),
    readFile(join(packageRoot, "RUNBOOK.md"), "utf8"),
  ]);

  assert.match(deploy, /run-probe\.sh/);
  assert.match(
    deploy,
    /"\$SCRIPT_DIR\/run-probe\.sh" "\$evidence"[\s\S]*db_file "\$RELEASE_SOURCE_ROOT\/packages\/database\/migrations\/\$TARGET_MIGRATION\.up\.sql"/,
  );
  assert.match(deploy, /n8n import:workflow|import_strategist_inactive/);
  assert.doesNotMatch(deploy, /systemctl (?:start|stop|restart)/);
  assert.doesNotMatch(deploy, /docker compose (?:up|down)/);
  assert.match(uat, /expected exactly two bilingual jobs/);
  assert.match(uat, /PENDING_HUMAN_REVIEW_DRAFTS=4/);
  assert.match(uat, /EXTERNAL_PROVIDER_OPERATIONS=0/);
  assert.doesNotMatch(uat, /queue_postiz|claim_ghl|publish/);
  assert.match(uat, /assert_zero_provider_activity/);
  assert.match(common, /assert_bilingual_jobs_quarantined/);
  assert.match(common, /assert_legacy_cadence_backfill_reviewed/);
  assert.match(common, /exactly three reviewed strategies/);
  assert.match(migration, /campaign_strategies_cadence_integrity_check/);
  assert.match(migration, /strategy_cadence_0028_legacy_backup/);
  assert.match(migration, /normalize_strategy_cadence_0028/);
  assert.match(migration, /regexp_matches\(v_text,'\(\[0-9\]\+\)'/);
  assert.match(migration, /FROM jsonb_object_keys\(p_posting_cadence\)/);
  assert.match(migration, /v_cadence_count <> v_channel_count/);
  assert.match(rollback, /original_posting_cadence/);
  assert.match(rollback, /DROP TABLE tanaghom\.strategy_cadence_0028_legacy_backup/);
  assert.match(legacyTest, /posts_per_week":5/);
  assert.match(legacyTest, /rollback did not restore the exact legacy cadence/);
  assert.match(runbook, /bounded to 2,048 output tokens/);
  assert.match(runbook, /single-source v2 model contract/);
  assert.match(runbook, /Missing customer inputs must not be bypassed/);
});
