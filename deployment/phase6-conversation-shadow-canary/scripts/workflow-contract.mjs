#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ID = "phase5ConversationIntelligenceV1";
const DB_CREDENTIAL = "62000000-0000-4000-8000-000000000005";
const GEMMA_CREDENTIAL = "62000000-0000-4000-8000-000000000002";
const GEMMA_URL = "https://api.thesmartlabs.net/gemma4/v1/chat/completions";

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

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireWorkflow(workflows) {
  const matches = workflows.filter((workflow) => workflow.id === ID);
  if (matches.length !== 1) throw new Error(`expected exactly one ${ID} workflow`);
  return matches[0];
}

function validateBoundary(workflow) {
  if (workflow.active !== false) throw new Error("Conversation Intelligence workflow must be inactive");
  const schedules = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  if (schedules.length !== 1 || schedules[0].disabled !== true) {
    throw new Error("Conversation Intelligence must have exactly one disabled schedule");
  }
  const manual = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.manualTrigger");
  if (manual.length !== 1) throw new Error("Conversation Intelligence must retain one controlled manual trigger");
  const forbiddenTypes = new Set([
    "n8n-nodes-base.executeCommand",
    "n8n-nodes-base.readWriteFile",
    "n8n-nodes-base.ssh",
    "n8n-nodes-base.webhook",
  ]);
  if (workflow.nodes.some((node) => forbiddenTypes.has(node.type))) {
    throw new Error("Conversation Intelligence contains a forbidden execution, file, SSH, or webhook node");
  }
  const urls = workflow.nodes.flatMap((node) => typeof node.parameters?.url === "string" ? [node.parameters.url] : []);
  if (urls.length !== 1 || urls[0] !== GEMMA_URL) throw new Error("Conversation Intelligence has an unexpected external endpoint");
  const dbIds = workflow.nodes.flatMap((node) => node.credentials?.postgres?.id ? [node.credentials.postgres.id] : []);
  if (!dbIds.length || dbIds.some((id) => id !== DB_CREDENTIAL)) throw new Error("Conversation Intelligence database credential boundary changed");
  const gemmaIds = workflow.nodes.flatMap((node) => node.credentials?.httpHeaderAuth?.id ? [node.credentials.httpHeaderAuth.id] : []);
  if (gemmaIds.length !== 1 || gemmaIds[0] !== GEMMA_CREDENTIAL) throw new Error("Conversation Intelligence Gemma credential boundary changed");
  const text = JSON.stringify(workflow).toLowerCase();
  for (const forbidden of ["leadconnectorhq", "postiz", "execute command", "read/write files", "ssh"]) {
    if (text.includes(forbidden)) throw new Error(`Conversation Intelligence contains forbidden reference: ${forbidden}`);
  }
}

async function prepare(exportPath, sourcePath, outputDir) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  const reviewed = JSON.parse(await readFile(resolve(sourcePath), "utf8"));
  if (!Array.isArray(exported)) throw new Error("n8n export must be an array");
  const current = requireWorkflow(exported);
  validateBoundary(current);
  validateBoundary(reviewed);
  const currentHash = digest(operational(current));
  const reviewedHash = digest(operational(reviewed));
  if (currentHash !== reviewedHash) throw new Error("production Conversation Intelligence differs from the reviewed export");
  await mkdir(resolve(outputDir), { recursive: true, mode: 0o700 });
  await writeFile(resolve(outputDir, `${ID}.original.json`), `${JSON.stringify([current], null, 2)}\n`, { mode: 0o600 });
  await writeFile(resolve(outputDir, "workflow-manifest.json"), `${JSON.stringify({
    contract: "tanaghom.conversation-shadow-canary.v1",
    workflow_id: ID,
    operational_sha256: currentHash,
    schedule_disabled: true,
    database_credential_id: DB_CREDENTIAL,
    gemma_credential_id: GEMMA_CREDENTIAL,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log("PASS: production Conversation Intelligence matches the reviewed inactive, schedule-disabled export.");
}

async function verify(exportPath, manifestPath) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const workflow = requireWorkflow(exported);
  validateBoundary(workflow);
  if (digest(operational(workflow)) !== manifest.operational_sha256) throw new Error("restored workflow operational hash mismatch");
  console.log("PASS: Conversation Intelligence is restored to the reviewed inactive operational hash.");
}

async function compareOthers(beforePath, afterPath) {
  const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const others = (rows) => rows.filter((row) => row.id !== ID).sort((a, b) => a.id.localeCompare(b.id)).map(stable);
  if (digest(others(before)) !== digest(others(after))) throw new Error("a non-canary n8n workflow changed");
  console.log("PASS: every non-canary n8n workflow is unchanged.");
}

const [action, ...args] = process.argv.slice(2);
if (action === "prepare" && args.length === 3) await prepare(...args);
else if (action === "verify" && args.length === 2) await verify(...args);
else if (action === "compare-others" && args.length === 2) await compareOthers(...args);
else throw new Error("usage: workflow-contract.mjs prepare EXPORT SOURCE OUTPUT_DIR | verify EXPORT MANIFEST | compare-others BEFORE AFTER");
