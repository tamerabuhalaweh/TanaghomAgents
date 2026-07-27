import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0033 counts canonical scenarios independently from invocation cardinality", async () => {
  const [up, down, integration, databaseTest] = await Promise.all([
    read("packages/database/migrations/0033_agent_runtime_certification_evidence.up.sql"),
    read("packages/database/migrations/0033_agent_runtime_certification_evidence.down.sql"),
    read("scripts/phase7d-runtime-certification-integration.mjs"),
    read("scripts/database-test.mjs"),
  ]);

  assert.match(up, /0033 requires exact 0032 baseline/);
  assert.match(up, /CREATE OR REPLACE FUNCTION tanaghom\.build_agent_runtime_certification_evidence/);
  assert.match(up, /CROSS JOIN LATERAL/);
  assert.match(up, /invocation_summary\.external_action_count/);
  assert.match(up, /'scenario_count',count\(scenario\.id\)/);
  assert.match(up, /'invocation_count',invocation_summary\.invocation_count/);
  assert.doesNotMatch(
    up,
    /LEFT JOIN tanaghom\.organization_agent_invocations invocation ON invocation\.run_id=run\.id/,
  );
  assert.match(up, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
  assert.match(up, /TO tanaghom_agent_runtime/);
  assert.match(down, /rollback refused because a certification relies on multi-invocation evidence/);
  assert.match(down, /0033 rollback requires exact 0033 baseline/);
  assert.match(integration, /multi_step_scenario_aggregation/);
  assert.match(integration, /canonical\.scenarios\.length, 14/);
  assert.match(integration, /scenario\.code === "en_success"/);
  assert.match(databaseTest, /agent_runtime_certification_evidence\.sql/);
  assert.match(databaseTest, /0033 rollback crossed the 0032 boundary/);
});
