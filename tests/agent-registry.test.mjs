import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("agent registry reconciles every shipped workflow export with reviewed runtime evidence", async () => {
  const registry = JSON.parse(await readFile(new URL("config/agent-registry.v1.json", root), "utf8"));
  assert.equal(registry.contract_version, "tanaghom.agent-registry.v1");
  assert.equal(registry.roles.length, 4);
  assert.equal(registry.workers.length, 8);
  assert.equal(new Set(registry.roles.map((role) => role.code)).size, 4);
  assert.equal(new Set(registry.workers.map((worker) => worker.code)).size, 8);
  assert.equal(new Set(registry.workers.map((worker) => worker.source_path)).size, 8);

  const roleCodes = new Set(registry.roles.map((role) => role.code));
  for (const worker of registry.workers) {
    assert.ok(roleCodes.has(worker.role_code), `${worker.code} has an unknown business role`);
    const workflow = JSON.parse(await readFile(new URL(worker.source_path, root), "utf8"));
    assert.equal(workflow.name, worker.workflow_name, `${worker.code} workflow name drifted`);
    assert.equal(workflow.active, false, `${worker.code} export must remain inactive`);
    const schedule = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
    assert.ok(schedule, `${worker.code} must declare its polling boundary`);
    if (worker.trigger_state === "disabled") {
      assert.equal(schedule.disabled, true, `${worker.code} schedule must be disabled`);
    } else if (worker.trigger_state === "workflow_inactive_only") {
      assert.notEqual(schedule.disabled, true, `${worker.code} trigger state no longer matches its export`);
      assert.notEqual(worker.runtime_state, "active");
    }
  }

  assert.equal(registry.workers.filter((worker) => worker.runtime_state === "imported_inactive").length, 4);
  assert.equal(registry.workers.filter((worker) => worker.runtime_state === "available_not_imported").length, 4);
  assert.equal(registry.workers.filter((worker) => worker.runtime_state === "active").length, 0);
  assert.deepEqual(
    registry.workers.slice(0, 5).map((worker) => worker.job_types[0]),
    [
      "campaign.strategy.generate",
      "campaign.content.generate",
      "content.postiz.draft",
      "postiz.performance.sync",
      "lead.ghl.contact_upsert",
    ],
  );
});

test("database registry seed stays aligned with the versioned contract", async () => {
  const registry = JSON.parse(await readFile(new URL("config/agent-registry.v1.json", root), "utf8"));
  const migration = `${await readFile(new URL("packages/database/migrations/0022_agent_registry.up.sql", root), "utf8")}\n${await readFile(new URL("packages/database/migrations/0024_conversation_intelligence_worker_registry.up.sql", root), "utf8")}`;
  for (const role of registry.roles) {
    assert.match(migration, new RegExp(`'${role.code}'`));
  }
  for (const worker of registry.workers) {
    assert.match(migration, new RegExp(`'${worker.code}'`));
    assert.match(migration, new RegExp(worker.source_path.replaceAll("/", "\\/")));
    assert.match(migration, new RegExp(`'${worker.runtime_state}'`));
  }
});
