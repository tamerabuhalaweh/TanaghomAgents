#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const definitions = {
  phase7dPolicyResolvedAgentRunnerV1: "policy-resolved-agent-runner.v1.json",
  phase7dSimulationDispatcherV1: "simulation-dispatcher.v1.json",
};
const ids = Object.keys(definitions);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function normalizedNodes(nodes) {
  return nodes.map((node) => ({
    ...node,
    ...(node.credentials ? {
      credentials: Object.fromEntries(
        Object.entries(node.credentials).map(([type, binding]) => [
          type,
          binding && typeof binding === "object"
            ? { ...binding, id: "<resolved-by-reviewed-name-and-type>" }
            : binding,
        ]),
      ),
    } : {}),
  }));
}

function operational(workflow) {
  return stable({
    id: workflow.id,
    name: workflow.name,
    active: workflow.active,
    nodes: normalizedNodes(workflow.nodes),
    connections: workflow.connections,
    settings: workflow.settings ?? {},
    staticData: workflow.staticData ?? null,
    pinData: workflow.pinData ?? {},
  });
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactWorkflow(workflows, id) {
  const matches = workflows.filter((workflow) => workflow.id === id);
  if (matches.length !== 1) throw new Error(`expected exactly one ${id}`);
  return matches[0];
}

function validateBoundary(workflow) {
  if (workflow.active !== false) throw new Error(`${workflow.id} must be inactive`);
  const schedules = workflow.nodes.filter(
    (node) => node.type === "n8n-nodes-base.scheduleTrigger",
  );
  if (schedules.some((node) => node.disabled !== true)) {
    throw new Error(`${workflow.id} has an enabled schedule`);
  }
  if (workflow.id === "phase7dPolicyResolvedAgentRunnerV1" && schedules.length !== 1) {
    throw new Error("the runner must retain exactly one disabled schedule");
  }
  if (workflow.id === "phase7dSimulationDispatcherV1" && schedules.length !== 0) {
    throw new Error("the called simulation dispatcher may not contain a schedule");
  }
  if (workflow.id === "phase7dSimulationDispatcherV1") {
    const triggers = workflow.nodes.filter((node) =>
      node.type.toLowerCase().includes("trigger"));
    if (triggers.length !== 1
      || triggers[0].type !== "n8n-nodes-base.executeWorkflowTrigger"
      || triggers[0].parameters?.inputSource !== "passthrough"
      || "workflowInputs" in (triggers[0].parameters ?? {})) {
      throw new Error(
        "the simulation dispatcher must expose only its passthrough internal workflow trigger",
      );
    }
  }
  if (workflow.nodes.some((node) => [
    "n8n-nodes-base.executeCommand",
    "n8n-nodes-base.readWriteFile",
    "n8n-nodes-base.ssh",
  ].includes(node.type))) {
    throw new Error(`${workflow.id} contains a forbidden node`);
  }
  const urls = workflow.nodes.flatMap((node) =>
    typeof node.parameters?.url === "string" ? [node.parameters.url] : []);
  if (workflow.id === "phase7dPolicyResolvedAgentRunnerV1"
    && (urls.length !== 1
      || urls[0] !== "https://api.thesmartlabs.net/gemma4/v1/chat/completions")) {
    throw new Error("the runner has an unexpected model endpoint");
  }
  if (workflow.id === "phase7dSimulationDispatcherV1" && urls.length !== 0) {
    throw new Error("the simulation dispatcher may not call an endpoint");
  }
  const text = JSON.stringify(workflow).toLowerCase();
  if (text.includes("postiz") || text.includes("gohighlevel")
    || text.includes("leadconnectorhq")) {
    throw new Error(`${workflow.id} contains a provider reference`);
  }
}

async function prepare(exportPath, sourceDirectory, outputDirectory) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  if (!Array.isArray(exported)) throw new Error("n8n export must be an array");
  await mkdir(resolve(outputDirectory), { recursive: true, mode: 0o700 });
  const manifest = {
    contract_version: "tanaghom.phase7f-agent-studio-canary.v1",
    workflows: {},
  };
  for (const id of ids) {
    const current = exactWorkflow(exported, id);
    const reviewed = JSON.parse(await readFile(
      resolve(sourceDirectory, definitions[id]),
      "utf8",
    ));
    validateBoundary(current);
    validateBoundary(reviewed);
    const currentHash = hash(operational(current));
    const reviewedHash = hash(operational(reviewed));
    if (currentHash !== reviewedHash) {
      throw new Error(`${id} differs from the reviewed repository export`);
    }
    manifest.workflows[id] = { operational_sha256: currentHash };
  }
  await writeFile(
    resolve(outputDirectory, "workflow-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log("PASS: the inactive runner and simulation dispatcher match reviewed operational hashes.");
}

function legacyDispatcher(reviewed) {
  const previous = JSON.parse(JSON.stringify(reviewed));
  const trigger = previous.nodes.find(
    (node) => node.type === "n8n-nodes-base.executeWorkflowTrigger",
  );
  trigger.parameters = { workflowInputs: { values: [] } };
  return previous;
}

async function prepareTransition(exportPath, sourceDirectory, outputDirectory) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  if (!Array.isArray(exported)) throw new Error("n8n export must be an array");
  await mkdir(resolve(outputDirectory), { recursive: true, mode: 0o700 });

  const currentRunner = exactWorkflow(
    exported,
    "phase7dPolicyResolvedAgentRunnerV1",
  );
  const currentDispatcher = exactWorkflow(
    exported,
    "phase7dSimulationDispatcherV1",
  );
  const reviewedRunner = JSON.parse(await readFile(
    resolve(sourceDirectory, definitions.phase7dPolicyResolvedAgentRunnerV1),
    "utf8",
  ));
  const reviewedDispatcher = JSON.parse(await readFile(
    resolve(sourceDirectory, definitions.phase7dSimulationDispatcherV1),
    "utf8",
  ));
  validateBoundary(currentRunner);
  validateBoundary(reviewedRunner);
  validateBoundary(reviewedDispatcher);
  if (hash(operational(currentRunner)) !== hash(operational(reviewedRunner))) {
    throw new Error("phase7dPolicyResolvedAgentRunnerV1 differs from the reviewed export");
  }

  const currentHash = hash(operational(currentDispatcher));
  const correctedHash = hash(operational(reviewedDispatcher));
  const legacyHash = hash(operational(legacyDispatcher(reviewedDispatcher)));
  let dispatcherState;
  if (currentHash === correctedHash) {
    validateBoundary(currentDispatcher);
    dispatcherState = "corrected_passthrough";
  } else if (currentHash === legacyHash) {
    dispatcherState = "legacy_empty_inputs";
  } else {
    throw new Error(
      "phase7dSimulationDispatcherV1 is neither the reviewed legacy nor corrected export",
    );
  }

  const manifest = {
    contract_version: "tanaghom.phase7f-dispatcher-transition.v1",
    dispatcher_state: dispatcherState,
    legacy_operational_sha256: legacyHash,
    corrected_operational_sha256: correctedHash,
    runner_operational_sha256: hash(operational(reviewedRunner)),
  };
  await writeFile(
    resolve(outputDirectory, "workflow-transition-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`PASS: dispatcher transition state is ${dispatcherState}.`);
}

async function verify(exportPath, manifestPath) {
  const exported = JSON.parse(await readFile(resolve(exportPath), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  for (const id of ids) {
    const workflow = exactWorkflow(exported, id);
    validateBoundary(workflow);
    if (hash(operational(workflow)) !== manifest.workflows[id]?.operational_sha256) {
      throw new Error(`${id} changed during the canary`);
    }
  }
  console.log("PASS: both canary workflows remain inactive and operationally unchanged.");
}

async function compareOthers(beforePath, afterPath) {
  const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const others = (rows) => rows
    .filter((row) => !ids.includes(row.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(stable);
  if (hash(others(before)) !== hash(others(after))) {
    throw new Error("a non-canary n8n workflow changed");
  }
  console.log("PASS: every non-canary n8n workflow is unchanged.");
}

async function compareExceptDispatcher(beforePath, afterPath) {
  const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const withoutDispatcher = (rows) => rows
    .filter((row) => row.id !== "phase7dSimulationDispatcherV1")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(stable);
  if (hash(withoutDispatcher(before)) !== hash(withoutDispatcher(after))) {
    throw new Error("an n8n workflow other than the dispatcher changed");
  }
  console.log("PASS: every n8n workflow except the reviewed dispatcher is unchanged.");
}

async function compareAllOperational(beforePath, afterPath) {
  const before = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const after = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const normalized = (rows) => rows
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => ({ id: row.id, operational: operational(row) }));
  if (hash(normalized(before)) !== hash(normalized(after))) {
    throw new Error("the operational n8n workflow state was not restored");
  }
  console.log("PASS: every n8n workflow was operationally restored.");
}

const [action, ...args] = process.argv.slice(2);
if (action === "prepare" && args.length === 3) await prepare(...args);
else if (action === "prepare-transition" && args.length === 3) {
  await prepareTransition(...args);
}
else if (action === "verify" && args.length === 2) await verify(...args);
else if (action === "compare-others" && args.length === 2) await compareOthers(...args);
else if (action === "compare-except-dispatcher" && args.length === 2) {
  await compareExceptDispatcher(...args);
} else if (action === "compare-all-operational" && args.length === 2) {
  await compareAllOperational(...args);
}
else {
  throw new Error(
    "usage: workflow-contract.mjs prepare|prepare-transition EXPORT SOURCE_DIR OUTPUT_DIR | "
    + "verify EXPORT MANIFEST | compare-others|compare-except-dispatcher|"
    + "compare-all-operational BEFORE AFTER",
  );
}
