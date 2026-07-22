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
  if (schedules.length !== 1 || schedules[0].disabled !== true) throw new Error("Conversation Intelligence schedule boundary changed");
  if (workflow.nodes.filter((node) => node.type === "n8n-nodes-base.manualTrigger").length !== 1) {
    throw new Error("Conversation Intelligence controlled trigger boundary changed");
  }
  const forbiddenTypes = new Set([
    "n8n-nodes-base.executeCommand", "n8n-nodes-base.readWriteFile",
    "n8n-nodes-base.ssh", "n8n-nodes-base.webhook",
  ]);
  if (workflow.nodes.some((node) => forbiddenTypes.has(node.type))) throw new Error("Conversation Intelligence contains a forbidden node");
  const urls = workflow.nodes.flatMap((node) => typeof node.parameters?.url === "string" ? [node.parameters.url] : []);
  if (urls.length !== 1 || urls[0] !== GEMMA_URL) throw new Error("Conversation Intelligence endpoint boundary changed");
  const dbIds = workflow.nodes.flatMap((node) => node.credentials?.postgres?.id ? [node.credentials.postgres.id] : []);
  if (!dbIds.length || dbIds.some((id) => id !== DB_CREDENTIAL)) throw new Error("Conversation Intelligence database credential boundary changed");
  const gemmaIds = workflow.nodes.flatMap((node) => node.credentials?.httpHeaderAuth?.id ? [node.credentials.httpHeaderAuth.id] : []);
  if (gemmaIds.length !== 1 || gemmaIds[0] !== GEMMA_CREDENTIAL) throw new Error("Conversation Intelligence Gemma credential boundary changed");
}

function validateGrammarHotfix(current, target) {
  const currentBuild = current.nodes.find((node) => node.name === "Build Conversation Request")?.parameters?.jsCode ?? "";
  const targetBuild = target.nodes.find((node) => node.name === "Build Conversation Request")?.parameters?.jsCode ?? "";
  const currentNormalize = current.nodes.find((node) => node.name === "Normalize Conversation Response")?.parameters?.jsCode ?? "";
  const targetNormalize = target.nodes.find((node) => node.name === "Normalize Conversation Response")?.parameters?.jsCode ?? "";
  if (currentBuild.includes('"uniqueItems":')) throw new Error("current workflow regressed to the unsupported Gemma grammar");
  if (targetBuild.includes('"uniqueItems":')) throw new Error("target workflow still sends unsupported uniqueItems to Gemma");
  if (!currentNormalize.includes("canonicalizeLegacyOutput") || !currentNormalize.includes("const legacyVariantA") || !currentNormalize.includes("const legacyVariantB")) {
    throw new Error("current workflow lacks the reviewed two-variant compatibility adapter");
  }
  if (currentBuild.includes("The response object must contain exactly these top-level keys")) throw new Error("current workflow already contains the target canonical prompt enforcement");
  if (!targetBuild.includes("The response object must contain exactly these top-level keys")
      || !targetBuild.includes("Do not return wrapper objects named")) {
    throw new Error("target workflow lacks explicit canonical prompt enforcement");
  }
  if (!targetNormalize.includes("canonicalizeLegacyOutput")
      || !targetNormalize.includes("const legacyVariantA")
      || !targetNormalize.includes("const legacyVariantB")
      || !targetNormalize.includes("proposal.content")
      || !targetNormalize.includes("citation?.text")
      || !targetNormalize.includes("source.source_id === citation.source_id && source.source_version_id === citation.source_version_id")
      || !targetNormalize.includes("content_fingerprint: approved.content_fingerprint")
      || !targetNormalize.includes("allowedEventIds.has(eventId)")) {
    throw new Error("target workflow lacks the strict approved-knowledge compatibility adapter");
  }
  if (!targetNormalize.includes("new Set(output.risk_categories).size") || !targetNormalize.includes("new Set(output.conversation_summary.input_event_ids).size")) {
    throw new Error("target workflow lost local uniqueness validation");
  }
}

function compareOthers(before, after) {
  const others = (rows) => rows.filter((row) => row.id !== ID).sort((a, b) => a.id.localeCompare(b.id)).map(stable);
  if (digest(others(before)) !== digest(others(after))) throw new Error("a non-hotfix n8n workflow changed");
}

async function loadWorkflow(path) {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  return Array.isArray(parsed) ? requireWorkflow(parsed) : parsed;
}

async function prepare(exportPath, targetPath, outputDir, expectedOldHash) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  if (!Array.isArray(exported)) throw new Error("n8n export must be an array");
  const current = requireWorkflow(exported);
  const target = await loadWorkflow(targetPath);
  validateBoundary(current);
  validateBoundary(target);
  validateGrammarHotfix(current, target);
  const oldHash = digest(operational(current));
  const targetHash = digest(operational(target));
  if (oldHash !== expectedOldHash) throw new Error("production workflow is not the approved pre-hotfix hash");
  if (targetHash === oldHash) throw new Error("target workflow does not change the incompatible grammar");
  await mkdir(resolve(outputDir), { recursive: true, mode: 0o700 });
  await writeFile(resolve(outputDir, `${ID}.original.json`), `${JSON.stringify([current], null, 2)}\n`, { mode: 0o600 });
  await writeFile(resolve(outputDir, "workflow-hotfix-manifest.json"), `${JSON.stringify({
    contract: "tanaghom.conversation-schema-hotfix.v4",
    workflow_id: ID,
    old_operational_sha256: oldHash,
    target_operational_sha256: targetHash,
    unsupported_keyword_removed: "uniqueItems",
    legacy_output_adapter: "two-exact-variants-strict-approved-knowledge-canonicalization",
    canonical_prompt_enforcement: true,
    local_uniqueness_validation_retained: true,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`PASS: production workflow is the exact ${oldHash} baseline and target ${targetHash} adds strict canonicalization without restoring unsupported grammar.`);
}

async function verifyTarget(beforePath, afterPath, targetPath, manifestPath) {
  const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const target = await loadWorkflow(targetPath);
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const current = requireWorkflow(after);
  validateBoundary(current);
  validateBoundary(target);
  if (digest(operational(current)) !== manifest.target_operational_sha256 || digest(operational(target)) !== manifest.target_operational_sha256) {
    throw new Error("deployed workflow does not match the reviewed hotfix target");
  }
  compareOthers(before, after);
  console.log("PASS: corrected Conversation Intelligence is inactive and every non-hotfix workflow is unchanged.");
}

async function verifyOriginal(exportPath, manifestPath) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const current = requireWorkflow(exported);
  validateBoundary(current);
  if (digest(operational(current)) !== manifest.old_operational_sha256) throw new Error("rollback did not restore the original operational hash");
  console.log("PASS: original Conversation Intelligence operational hash is restored inactive.");
}

async function validateTarget(targetPath, expectedOldHash) {
  const target = await loadWorkflow(targetPath);
  validateBoundary(target);
  const build = target.nodes.find((node) => node.name === "Build Conversation Request")?.parameters?.jsCode ?? "";
  const normalize = target.nodes.find((node) => node.name === "Normalize Conversation Response")?.parameters?.jsCode ?? "";
  if (build.includes('"uniqueItems":')) throw new Error("target still contains unsupported uniqueItems");
  if (!build.includes("The response object must contain exactly these top-level keys")
      || !build.includes("Do not return wrapper objects named")) {
    throw new Error("target lacks explicit canonical prompt enforcement");
  }
  if (!normalize.includes("canonicalizeLegacyOutput")
      || !normalize.includes("const legacyVariantA")
      || !normalize.includes("const legacyVariantB")
      || !normalize.includes("proposal.content")
      || !normalize.includes("citation?.text")
      || !normalize.includes("source.source_id === citation.source_id && source.source_version_id === citation.source_version_id")
      || !normalize.includes("content_fingerprint: approved.content_fingerprint")
      || !normalize.includes("allowedEventIds.has(eventId)")) {
    throw new Error("target lacks the strict approved-knowledge compatibility adapter");
  }
  if (!normalize.includes("new Set(output.risk_categories).size") || !normalize.includes("new Set(output.conversation_summary.input_event_ids).size")) {
    throw new Error("target lost local uniqueness validation");
  }
  const targetHash = digest(operational(target));
  if (targetHash === expectedOldHash) throw new Error("target hash equals the pre-hotfix hash");
  console.log(`PASS: target ${targetHash} retains compatible grammar, adds strict canonicalization, and preserves local validation.`);
}

const [action, ...args] = process.argv.slice(2);
if (action === "prepare" && args.length === 4) await prepare(...args);
else if (action === "verify-target" && args.length === 4) await verifyTarget(...args);
else if (action === "verify-original" && args.length === 2) await verifyOriginal(...args);
else if (action === "validate-target" && args.length === 2) await validateTarget(...args);
else throw new Error("usage: hotfix-contract.mjs prepare EXPORT TARGET OUTPUT_DIR OLD_HASH | verify-target BEFORE AFTER TARGET MANIFEST | verify-original EXPORT MANIFEST | validate-target TARGET OLD_HASH");
