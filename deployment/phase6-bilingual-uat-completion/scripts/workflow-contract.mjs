import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [livePath, reviewedPath] = process.argv.slice(2);
if (!livePath || !reviewedPath) {
  console.error("usage: workflow-contract.mjs LIVE REVIEWED");
  process.exit(2);
}

async function readWorkflow(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  return Array.isArray(value) ? value[0] : value;
}

function code(workflow, name) {
  const found = workflow.nodes.find((node) => node.name === name);
  assert.ok(found, `${name} is missing`);
  return found.parameters.jsCode;
}

const [live, reviewed] = await Promise.all([
  readWorkflow(livePath),
  readWorkflow(reviewedPath),
]);
assert.equal(live.id, "phase3StrategistV1");
assert.equal(reviewed.id, "phase3StrategistV1");
for (const name of ["Build Gemma Request", "Parse and Check Contract"]) {
  const liveCode = code(live, name);
  const reviewedCode = code(reviewed, name);
  assert.equal(liveCode, reviewedCode, `${name} differs from the reviewed export`);
  console.log(`${name.replaceAll(" ", "_").toUpperCase()}_SHA256=${
    createHash("sha256").update(liveCode).digest("hex")
  }`);
}
const schedules = live.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
assert.equal(schedules.length, 1);
assert.equal(Boolean(schedules[0].disabled), false);
console.log("PASS: live Strategist request, parser, and enabled schedule match the reviewed export.");
