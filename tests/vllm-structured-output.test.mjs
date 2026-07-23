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
    join(root, "packages/contracts/schemas/phase3/strategist-output.v1.schema.json"),
    "utf8",
  ));
  const cadence = strategist.oneOf[0].properties.posting_cadence;
  assert.equal(cadence.additionalProperties, false);
  assert.equal(Object.keys(cadence.properties).length, 7);
});
