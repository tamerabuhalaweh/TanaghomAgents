import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0032 adds an immutable replacement for the invalid historical model alias", async () => {
  const [up, down, assertions] = await Promise.all([
    read("packages/database/migrations/0032_gemma_served_model_profile.up.sql"),
    read("packages/database/migrations/0032_gemma_served_model_profile.down.sql"),
    read("packages/database/tests/gemma_served_model_profile.sql"),
  ]);

  assert.match(up, /0032 requires exact 0031 baseline/);
  assert.match(up, /gemma4_vllm_strict_v1/);
  assert.match(up, /gemma4_26b_a4b_canary_strict_v1/);
  assert.match(up, /gemma4-26b-a4b-canary/);
  assert.doesNotMatch(up, /UPDATE tanaghom\.agent_runtime_profiles/);
  assert.match(down, /durable runtime evidence references the served-model profile/);
  assert.match(down, /DISABLE TRIGGER agent_runtime_profile_immutable/);
  assert.match(down, /ENABLE TRIGGER agent_runtime_profile_immutable/);
  assert.match(assertions, /served-model runtime profile unexpectedly allowed mutation/);
});
