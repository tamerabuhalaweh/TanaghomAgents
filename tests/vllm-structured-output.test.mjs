import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("Gemma workflows use vLLM-compatible strict structured-output schemas", async () => {
  const validation = spawnSync(
    process.execPath,
    [join(root, "scripts", "validate-vllm-structured-output-schemas.mjs")],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);

  for (const path of [
    "n8n/workflows/phase3/campaign-strategist.v1.json",
    "n8n/workflows/phase3/content-producer.v1.json",
  ]) {
    const workflow = JSON.parse(await readFile(join(root, path), "utf8"));
    const request = workflow.nodes.find((node) => node.name === "Build Gemma Request");
    assert.ok(request);
    assert.match(request.parameters.jsCode, /"strict":true/);
  }

  const strategist = JSON.parse(await readFile(
    join(root, "packages/contracts/schemas/phase3/strategist-output.v2.schema.json"),
    "utf8",
  ));
  const cadence = strategist.oneOf[0].properties.posting_cadence;
  assert.equal(cadence.additionalProperties, false);
  assert.equal("minProperties" in cadence, false);
  assert.equal(Object.keys(cadence.properties).length, 7);
  assert.equal("channels" in strategist.oneOf[0].properties, false);

  const workflow = JSON.parse(await readFile(
    join(root, "n8n/workflows/phase3/campaign-strategist.v1.json"),
    "utf8",
  ));
  const request = workflow.nodes.find((node) => node.name === "Build Gemma Request");
  assert.doesNotMatch(request.parameters.jsCode, /"minProperties"/);
  assert.match(request.parameters.jsCode, /temperature: 0,/);
  assert.match(request.parameters.jsCode, /max_tokens: 4096,/);
  assert.match(
    request.parameters.jsCode,
    /do not return a separate channel list/,
  );
  assert.match(request.parameters.jsCode, /phase3\.strategist-output\.v2/);
  assert.doesNotMatch(request.parameters.jsCode, /"channels":\{"type":"array"/);
  assert.match(
    request.parameters.jsCode,
    /campaign\.brief` for the raw offer brief/,
  );
  assert.match(
    request.parameters.jsCode,
    /campaign\.target_audience\.audience` for the clear audience description/,
  );
  assert.match(
    request.parameters.jsCode,
    /do not additionally require(?:\\n|\s)+`campaign\.age_range`/,
  );
  assert.match(
    request.parameters.jsCode,
    /Do not look for `campaign\.raw_offer_brief`/,
  );
  assert.match(
    request.parameters.jsCode,
    /include the required `message`/,
  );

  const parser = workflow.nodes.find((node) => node.name === "Parse and Check Contract");
  assert.ok(parser);
  const runParser = (output) => new Function("$", "$json", parser.parameters.jsCode)(
    () => ({ first: () => ({ json: { job_id: "test-job", input: {} } }) }),
    { choices: [{ message: { content: JSON.stringify(output) } }] },
  )[0].json;
  const truncated = new Function("$", "$json", parser.parameters.jsCode)(
    () => ({ first: () => ({ json: { job_id: "test-job", input: {} } }) }),
    { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
  )[0].json;
  assert.equal(truncated.ok, false);
  assert.equal(truncated.error_code, "gemma_output_truncated");
  const base = {
    contract_version: "phase3.strategist-output.v2",
    status: "ok",
    positioning: "Test",
    key_messages: ["One", "Two", "Three"],
    content_pillars: [
      { name: "A", description: "A", example_angles: ["A"] },
      { name: "B", description: "B", example_angles: ["B"] },
      { name: "C", description: "C", example_angles: ["C"] },
      { name: "D", description: "D", example_angles: ["D"] },
    ],
  };
  const empty = runParser({
    ...base,
    posting_cadence: {},
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.error_code, "gemma_contract_mismatch");

  const valid = runParser({
    ...base,
    posting_cadence: {
      instagram: { posts_per_week: 2 },
      linkedin: { posts_per_week: 3 },
    },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.output.contract_version, "phase3.strategist-output.v1");
  assert.deepEqual(valid.output.channels, ["instagram", "linkedin"]);
  assert.deepEqual(Object.keys(valid.output.posting_cadence).sort(), valid.output.channels);

  const blocked = runParser({
    contract_version: "phase3.strategist-output.v2",
    status: "blocked_missing_info",
    missing_fields: ["target_audience.geographies"],
    message: "Target geography is required.",
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.output.contract_version, "phase3.strategist-output.v1");
});
