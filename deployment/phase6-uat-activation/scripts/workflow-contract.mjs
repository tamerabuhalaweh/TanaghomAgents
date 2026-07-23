import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
assert(root, "repository root is required");

const definitions = [
  ["n8n/workflows/phase3/campaign-strategist.v1.json", "phase3StrategistV1", true],
  ["n8n/workflows/phase3/content-producer.v1.json", "phase3ContentProducerV1", true],
  ["n8n/workflows/phase4/postiz-draft-publisher.v1.json", "phase4PostizDraftV1", false],
  ["n8n/workflows/phase4/postiz-performance-monitor.v1.json", "phase4PostizPerformanceV1", false],
  ["n8n/workflows/phase5/ghl-contact-sync.v1.json", "phase5GhlContactUpsertV1", false],
  ["n8n/workflows/phase5/conversation-intelligence.v1.json", "phase5ConversationIntelligenceV1", false],
  ["n8n/workflows/phase5/governed-ghl-actions.v1.json", "phase5GovernedGhlActionsV1", false],
  ["n8n/workflows/phase5g/quality-shadow-evaluator.v1.json", "phase5gQualityShadowEvaluatorV1", false],
];

const ids = new Set();
for (const [relativePath, expectedId, scheduleEnabled] of definitions) {
  const workflow = JSON.parse(await readFile(join(root, relativePath), "utf8"));
  assert.equal(workflow.id, expectedId, `${relativePath}: workflow ID`);
  assert.equal(workflow.active, false, `${relativePath}: source must remain inactive`);
  assert(!ids.has(workflow.id), `${relativePath}: duplicate workflow ID`);
  ids.add(workflow.id);

  const schedules = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(schedules.length, 1, `${relativePath}: exact schedule count`);
  assert.equal(!Boolean(schedules[0].disabled), scheduleEnabled, `${relativePath}: schedule state`);
  assert.equal(
    workflow.nodes.filter((node) => node.type === "n8n-nodes-base.webhook").length,
    0,
    `${relativePath}: public webhook is forbidden`,
  );

  const urls = workflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.httpRequest")
    .map((node) => String(node.parameters?.url || ""));
  for (const url of urls) {
    assert(
      url === "https://api.thesmartlabs.net/gemma4/v1/chat/completions" ||
        url.startsWith("={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL }}"),
      `${relativePath}: unreviewed outbound URL ${url}`,
    );
  }

  const credentials = new Set(
    workflow.nodes.flatMap((node) => Object.values(node.credentials || {}).map((credential) => credential.id)),
  );
  assert(credentials.has("62000000-0000-4000-8000-000000000001") ||
    credentials.has("62000000-0000-4000-8000-000000000005"),
  `${relativePath}: restricted PostgreSQL credential is required`);
  if (urls.some((url) => url.startsWith("={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL }}"))) {
    assert(credentials.has("62000000-0000-4000-8000-000000000004"),
      `${relativePath}: private gateway credential is required`);
  }
}

assert.equal(ids.size, 8);
console.log("PASS: eight reviewed Tanaghom workflows have exact IDs, trigger states, credential boundaries, and outbound URLs.");
