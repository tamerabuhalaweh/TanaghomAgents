#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const IDS = ["phase3StrategistV1", "phase3ContentProducerV1"];
const FILES = {
  phase3StrategistV1: "campaign-strategist.v1.json",
  phase3ContentProducerV1: "content-producer.v1.json",
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function operational(workflow) {
  return stable({
    id: workflow.id,
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
    staticData: workflow.staticData ?? null,
    pinData: workflow.pinData ?? {},
  });
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireWorkflow(workflows, id) {
  const matches = workflows.filter((workflow) => workflow.id === id);
  if (matches.length !== 1) throw new Error(`expected exactly one ${id} workflow`);
  return matches[0];
}

function validateBoundary(workflow, requireDisabledSchedule) {
  if (workflow.active !== false) throw new Error(`${workflow.id} must be inactive`);
  const schedules = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  if (schedules.length !== 1) throw new Error(`${workflow.id} must have one schedule trigger`);
  if (requireDisabledSchedule && schedules[0].disabled !== true) throw new Error(`${workflow.id} schedule is not disabled`);
  const forbidden = workflow.nodes.filter((node) => [
    "n8n-nodes-base.executeCommand", "n8n-nodes-base.readWriteFile", "n8n-nodes-base.ssh",
  ].includes(node.type));
  if (forbidden.length) throw new Error(`${workflow.id} contains a forbidden node`);
  const urls = workflow.nodes.flatMap((node) => typeof node.parameters?.url === "string" ? [node.parameters.url] : []);
  if (urls.length !== 1 || urls[0] !== "https://api.thesmartlabs.net/gemma4/v1/chat/completions") {
    throw new Error(`${workflow.id} has an unexpected external endpoint`);
  }
  const text = JSON.stringify(workflow).toLowerCase();
  if (text.includes("postiz") || text.includes("gohighlevel") || text.includes("leadconnectorhq")) {
    throw new Error(`${workflow.id} contains a publishing or CRM reference`);
  }
}

async function prepare(exportPath, sourceDir, outputDir) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  if (!Array.isArray(exported)) throw new Error("n8n export must be an array");
  await mkdir(resolve(outputDir), { recursive: true, mode: 0o700 });
  const manifest = { contract: "tanaghom.core-agent-canary.v1", workflows: {} };

  for (const id of IDS) {
    const current = requireWorkflow(exported, id);
    const reviewed = JSON.parse(await readFile(resolve(sourceDir, FILES[id]), "utf8"));
    validateBoundary(current, false);
    validateBoundary(reviewed, false);
    if (hash(operational(current)) !== hash(operational(reviewed))) {
      throw new Error(`${id} production definition differs from the reviewed repository export`);
    }
    const canary = structuredClone(reviewed);
    canary.active = false;
    for (const node of canary.nodes) {
      if (node.type === "n8n-nodes-base.scheduleTrigger") node.disabled = true;
    }
    validateBoundary(canary, true);

    const originalPath = resolve(outputDir, `${id}.original.json`);
    const canaryPath = resolve(outputDir, `${id}.canary.json`);
    await writeFile(originalPath, `${JSON.stringify([current], null, 2)}\n`, { mode: 0o600 });
    await writeFile(canaryPath, `${JSON.stringify([canary], null, 2)}\n`, { mode: 0o600 });
    manifest.workflows[id] = {
      name: current.name,
      original_operational_sha256: hash(operational(current)),
      canary_operational_sha256: hash(operational(canary)),
      schedule_disabled: true,
    };
  }
  await writeFile(resolve(outputDir, "workflow-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

async function verify(exportPath, manifestPath, expectedMode) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  for (const id of IDS) {
    const workflow = requireWorkflow(exported, id);
    validateBoundary(workflow, expectedMode === "canary");
    const actual = hash(operational(workflow));
    const expected = manifest.workflows[id][`${expectedMode}_operational_sha256`];
    if (actual !== expected) throw new Error(`${id} ${expectedMode} definition hash mismatch`);
  }
  console.log(`PASS: both core workflows match the ${expectedMode} operational hashes and are inactive.`);
}

async function compareOthers(beforePath, afterPath) {
  const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const other = (rows) => rows.filter((row) => !IDS.includes(row.id)).sort((a, b) => a.id.localeCompare(b.id)).map(stable);
  if (hash(other(before)) !== hash(other(after))) throw new Error("a non-canary n8n workflow changed");
  console.log("PASS: every non-canary n8n workflow is unchanged.");
}

const [action, ...args] = process.argv.slice(2);
if (action === "prepare" && args.length === 3) await prepare(...args);
else if (action === "verify" && args.length === 3 && ["original", "canary"].includes(args[2])) await verify(...args);
else if (action === "compare-others" && args.length === 2) await compareOthers(...args);
else throw new Error("usage: workflow-contract.mjs prepare EXPORT SOURCE_DIR OUTPUT_DIR | verify EXPORT MANIFEST original|canary | compare-others BEFORE AFTER");
