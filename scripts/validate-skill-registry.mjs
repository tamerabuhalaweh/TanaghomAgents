import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryPath = join(root, "config", "skill-registry.v1.json");
const registrySchemaPath = join(
  root,
  "packages",
  "contracts",
  "schemas",
  "phase7",
  "skill-registry.v1.schema.json",
);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isClosedObjectSchema(schema) {
  if (schema?.type === "object" && schema.additionalProperties === false) return true;
  return Array.isArray(schema?.oneOf)
    && schema.oneOf.length > 0
    && schema.oneOf.every((branch) => branch?.type === "object" && branch.additionalProperties === false);
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md requires YAML frontmatter");
  const metadata = Object.fromEntries(match[1].split("\n").map((line) => {
    const separator = line.indexOf(":");
    assert.ok(separator > 0, `invalid SKILL.md frontmatter line: ${line}`);
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  assert.deepEqual(Object.keys(metadata).sort(), ["description", "name"]);
  return metadata;
}

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else files.push(path);
  }
  return files;
}

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const registrySchema = JSON.parse(await readFile(registrySchemaPath, "utf8"));
const migration = await readFile(
  join(root, "packages", "database", "migrations", "0026_skill_registry.up.sql"),
  "utf8",
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRegistry = ajv.compile(registrySchema);
assert.equal(validateRegistry(registry), true, JSON.stringify(validateRegistry.errors, null, 2));

assert.equal(registry.skills.length, 8);
assert.equal(new Set(registry.skills.map((skill) => skill.id)).size, 8);
assert.equal(new Set(registry.skills.map((skill) => skill.code)).size, 8);
assert.equal(new Set(registry.skills.map((skill) => skill.version.id)).size, 8);

const agentRegistry = JSON.parse(await readFile(join(root, "config", "agent-registry.v1.json"), "utf8"));
const workers = new Map(agentRegistry.workers.map((worker) => [worker.code, worker]));
const boundWorkers = [];

for (const skill of registry.skills) {
  assert.equal(skill.owner_scope, "platform");
  assert.equal(skill.organization_id, null);
  assert.equal(skill.version.lifecycle_state, "published");
  assert.ok(skill.bindings.length >= 1);
  assert.equal(skill.version.executor.type, "pinned_n8n_workflow");
  assert.deepEqual(
    [...skill.version.integration_requirements].sort(),
    [...skill.version.permission_manifest.integrations].sort(),
    `${skill.code} integration requirements drifted from its permission manifest`,
  );
  for (const value of Object.values(skill.version.permission_manifest)) {
    assert.equal(new Set(value).size, value.length, `${skill.code} permission values must be unique`);
  }
  for (const value of [
    skill.id,
    skill.code,
    skill.version.id,
    skill.version.package_path,
    skill.version.content_hash,
    skill.version.tool_schema_hash,
  ]) {
    assert.ok(migration.includes(value), `${skill.code} is not reconciled in migration 0026`);
  }

  const packagePath = join(root, skill.version.package_path);
  const packageContent = await readFile(packagePath);
  const packageText = packageContent.toString("utf8");
  const metadata = frontmatter(packageText);
  assert.equal(metadata.name, basename(dirname(packagePath)));
  assert.ok(metadata.description.length >= 20);
  assert.equal(sha256(packageContent), skill.version.content_hash, `${skill.code} content hash drifted`);

  const inputPath = join(root, skill.version.input_schema_ref);
  const outputPath = join(root, skill.version.output_schema_ref);
  const inputSchema = JSON.parse(await readFile(inputPath, "utf8"));
  const outputSchema = JSON.parse(await readFile(outputPath, "utf8"));
  assert.ok(isClosedObjectSchema(inputSchema), `${skill.code} input schema must be a closed object`);
  assert.ok(isClosedObjectSchema(outputSchema), `${skill.code} output schema must be a closed object`);
  const contractValidator = new Ajv2020({ allErrors: true, strict: false });
  addFormats(contractValidator);
  contractValidator.compile(inputSchema);
  contractValidator.compile(outputSchema);
  const toolSchemaHash = sha256(`${canonicalJson(inputSchema)}\n${canonicalJson(outputSchema)}`);
  assert.equal(toolSchemaHash, skill.version.tool_schema_hash, `${skill.code} tool schema hash drifted`);

  for (const binding of skill.bindings) {
    const worker = workers.get(binding.worker_code);
    assert.ok(worker, `${skill.code} references unknown worker ${binding.worker_code}`);
    assert.equal(worker.role_code, binding.role_code, `${skill.code} role binding drifted`);
    assert.equal(skill.version.executor.ref, binding.worker_code);
    assert.equal(skill.version.executor.version, worker.workflow_version);
    boundWorkers.push(binding.worker_code);
  }
}

assert.deepEqual([...boundWorkers].sort(), [...workers.keys()].sort());
assert.equal(new Set(boundWorkers).size, workers.size);

const packageFiles = await collect(join(root, "skills", "platform"));
assert.equal(packageFiles.length, 8);
assert.ok(packageFiles.every((path) => basename(path) === "SKILL.md"));
assert.ok(packageFiles.every((path) => !relative(root, path).split(/[\\/]/).includes("scripts")));

const wildcard = structuredClone(registry);
wildcard.skills[0].version.permission_manifest.operations = ["*"];
assert.equal(validateRegistry(wildcard), false, "wildcard permission must be rejected");

const unknownExecutor = structuredClone(registry);
unknownExecutor.skills[0].version.executor.type = "customer_script";
assert.equal(validateRegistry(unknownExecutor), false, "unknown executor must be rejected");

const invalidPlatformScope = structuredClone(registry);
invalidPlatformScope.skills[0].organization_id = "10000000-0000-4000-8000-000000000001";
assert.equal(validateRegistry(invalidPlatformScope), false, "platform skill cannot carry an organization id");

console.log("PASS: eight immutable platform skills, strict schemas, hashes, bindings, and safe exports verified.");
