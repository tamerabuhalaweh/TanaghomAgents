import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPaths = [
  "packages/contracts/schemas/phase3/strategist-output.v1.schema.json",
  "packages/contracts/schemas/phase3/content-producer-output.v1.schema.json",
  "packages/contracts/schemas/phase5/conversation-intelligence-output.v1.schema.json",
  "packages/contracts/schemas/phase5g/quality-shadow-result.v1.schema.json",
];

const removedBeforeVllm = new Set(["$schema", "$id", "title", "uniqueItems", "format"]);

function guidedSchema(value) {
  if (Array.isArray(value)) return value.map(guidedSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !removedBeforeVllm.has(key))
    .map(([key, entry]) => [key, guidedSchema(entry)]));
}

function validateSchema(value, location) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSchema(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  if (value.type === "object") {
    assert.equal("patternProperties" in value, false, `${location}: xgrammar forbids patternProperties`);
    assert.equal("propertyNames" in value, false, `${location}: xgrammar forbids propertyNames`);
    const properties = value.properties ?? {};
    assert.equal(typeof properties, "object", `${location}: object properties must be an object`);
    const propertyNames = Object.keys(properties);
    if (value.minProperties !== undefined) {
      assert.ok(Number.isInteger(value.minProperties) && value.minProperties >= 0,
        `${location}: minProperties must be a non-negative integer`);
      if (value.additionalProperties === false) {
        assert.ok(value.minProperties <= propertyNames.length,
          `${location}: minProperties exceeds the closed object's defined properties`);
      }
    }
    for (const required of value.required ?? []) {
      assert.ok(propertyNames.includes(required),
        `${location}: required property ${required} is not defined`);
    }
  }

  if (["integer", "number"].includes(value.type)) {
    assert.equal("multipleOf" in value, false, `${location}: xgrammar forbids multipleOf`);
  }
  if (value.type === "array") {
    for (const keyword of ["uniqueItems", "contains", "minContains", "maxContains"]) {
      assert.equal(keyword in value, false, `${location}: xgrammar forbids ${keyword}`);
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    validateSchema(entry, `${location}.${key}`);
  }
}

for (const relativePath of schemaPaths) {
  const source = JSON.parse(await readFile(join(root, relativePath), "utf8"));
  validateSchema(guidedSchema(source), relativePath);
}

const strategist = guidedSchema(JSON.parse(await readFile(join(root, schemaPaths[0]), "utf8")));
const cadence = strategist.oneOf[0].properties.posting_cadence;
const allowedChannels = ["instagram", "tiktok", "facebook", "linkedin", "youtube", "email", "whatsapp_status"];
assert.deepEqual(Object.keys(cadence.properties), allowedChannels);
assert.equal(cadence.additionalProperties, false);
assert.equal(cadence.minProperties, 1);
for (const channel of allowedChannels) {
  assert.deepEqual(cadence.properties[channel].required, ["posts_per_week"]);
  assert.equal(cadence.properties[channel].properties.posts_per_week.minimum, 1);
  assert.equal(cadence.properties[channel].properties.posts_per_week.maximum, 14);
}

console.log("PASS: every Gemma response schema is sanitized and compatible with the reviewed vLLM/xgrammar boundary.");
