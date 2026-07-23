import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "deployment", "phase6-bilingual-uat-resume");

test("Arabic bilingual resume is exact, bounded, provider-free, and forward-only", async () => {
  const [common, probe, preflight, deploy, validate, resume, rollback, runbook] =
    await Promise.all([
      readFile(join(packageRoot, "scripts", "common.sh"), "utf8"),
      readFile(join(packageRoot, "scripts", "run-arabic-probe.sh"), "utf8"),
      readFile(join(packageRoot, "scripts", "preflight.sh"), "utf8"),
      readFile(join(packageRoot, "scripts", "deploy-token-correction.sh"), "utf8"),
      readFile(join(packageRoot, "scripts", "validate-token-correction.sh"), "utf8"),
      readFile(join(packageRoot, "scripts", "resume-bilingual-uat.sh"), "utf8"),
      readFile(join(packageRoot, "scripts", "rollback-token-correction.sh"), "utf8"),
      readFile(join(packageRoot, "RUNBOOK.md"), "utf8"),
    ]);

  assert.match(common, /assert_partial_bilingual_state/);
  assert.match(common, /job\.error_code='gemma_invalid_json'/);
  assert.match(common, /successful English strategy is unavailable or invalid/);
  assert.match(probe, /\.test Arabic Core-Agent UAT 2026-07-23/);
  assert.match(probe, /MAX_OUTPUT_TOKENS=4096/);
  assert.match(deploy, /run-arabic-probe\.sh/);
  assert.match(
    deploy,
    /run-arabic-probe\.sh" "\$evidence"[\s\S]*unpublish_workflow "\$STRATEGIST_ID"/,
  );
  assert.match(preflight, /max_tokens: 4096/);
  assert.match(preflight, /gemma_output_truncated/);
  assert.match(validate, /assert_zero_provider_activity/);
  assert.match(resume, /expected exactly one terminal Arabic strategy job/);
  assert.match(resume, /TANAGHOM_BILINGUAL_CONTINUE_ONLY=true/);
  assert.match(resume, /reviewed_4096_token_ceiling/);
  assert.match(rollback, /Arabic job was requeued; use forward correction/);
  assert.match(runbook, /preserves the successful English strategy/);
  assert.match(runbook, /four pending human-review drafts/);

  const runtime = `${common}\n${probe}\n${preflight}\n${deploy}\n${validate}\n${resume}\n${rollback}`;
  assert.doesNotMatch(runtime, /systemctl (?:start|stop|restart)|iptables|nft|nginx|docker compose|\/opt\/(?:smartlabs|smartcc)|\/data\//i);
  assert.doesNotMatch(runtime, /queue_postiz|claim_ghl|publish.*provider/i);
  assert.doesNotMatch(`${runtime}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@(?:38\.|aws-)/);
});
