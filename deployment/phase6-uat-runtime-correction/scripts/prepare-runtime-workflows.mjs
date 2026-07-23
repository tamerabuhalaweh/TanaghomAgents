import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [root, destination] = process.argv.slice(2);
if (!root || !destination) {
  console.error("usage: prepare-runtime-workflows.mjs ROOT DESTINATION");
  process.exit(2);
}

const definitions = [
  ["phase3StrategistV1", "n8n/workflows/phase3/campaign-strategist.v1.json", true],
  ["phase3ContentProducerV1", "n8n/workflows/phase3/content-producer.v1.json", true],
  ["phase4PostizDraftV1", "n8n/workflows/phase4/postiz-draft-publisher.v1.json", false],
  ["phase4PostizPerformanceV1", "n8n/workflows/phase4/postiz-performance-monitor.v1.json", false],
  ["phase5GhlContactUpsertV1", "n8n/workflows/phase5/ghl-contact-sync.v1.json", false],
  ["phase5ConversationIntelligenceV1", "n8n/workflows/phase5/conversation-intelligence.v1.json", false],
  ["phase5GovernedGhlActionsV1", "n8n/workflows/phase5/governed-ghl-actions.v1.json", false],
  ["phase5gQualityShadowEvaluatorV1", "n8n/workflows/phase5g/quality-shadow-evaluator.v1.json", false],
];

await mkdir(destination, { recursive: true });
for (const [id, relativePath, sourceScheduleEnabled] of definitions) {
  const workflow = JSON.parse(await readFile(join(root, relativePath), "utf8"));
  assert.equal(workflow.id, id);
  assert.equal(workflow.active, false);
  const schedules = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(schedules.length, 1, `${id}: exactly one schedule is required`);
  assert.equal(!Boolean(schedules[0].disabled), sourceScheduleEnabled,
    `${id}: reviewed source schedule state changed`);

  const oldName = schedules[0].name;
  const newName = sourceScheduleEnabled ? oldName : "Policy-Gated Polling";
  schedules[0].disabled = false;
  schedules[0].name = newName;
  if (oldName !== newName) {
    assert.ok(workflow.connections[oldName], `${id}: schedule connection missing`);
    workflow.connections[newName] = workflow.connections[oldName];
    delete workflow.connections[oldName];
  }

  workflow.active = false;
  workflow.meta = {
    ...workflow.meta,
    tanaghomRuntimeProfile: "uat-policy-gated-polling-v1",
  };
  await writeFile(join(destination, `${id}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
}

console.log("PASS: prepared eight runtime workflows with valid policy-gated schedules.");
