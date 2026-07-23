import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [command, first, second, third] = process.argv.slice(2);

if (command === "build") {
  const workflow = JSON.parse(await readFile(first, "utf8"));
  const claimed = JSON.parse(await readFile(second, "utf8"));
  const node = workflow.nodes.find((candidate) => candidate.name === "Build Gemma Request");
  assert.ok(node);
  const request = new Function("$json", node.parameters.jsCode)(claimed)?.[0]?.json?.request;
  assert.equal(request?.model, "gemma4-26b-a4b-canary");
  assert.equal(request?.temperature, 0);
  assert.equal(request?.max_tokens, 2048);
  assert.equal(request?.response_format?.type, "json_schema");
  assert.equal(request?.response_format?.json_schema?.strict, true);
  function hasUnsupported(value) {
    if (Array.isArray(value)) return value.some(hasUnsupported);
    if (!value || typeof value !== "object") return false;
    if (Object.hasOwn(value, "minProperties")) return true;
    return Object.values(value).some(hasUnsupported);
  }
  assert.equal(hasUnsupported(request.response_format), false);
  await writeFile(third, JSON.stringify(request));
  console.log("PASS: built exact corrected Strategist probe request.");
} else if (command === "validate") {
  const body = JSON.parse(await readFile(first, "utf8"));
  assert.notEqual(body?.choices?.[0]?.finish_reason, "length");
  const raw = body?.choices?.[0]?.message?.content;
  assert.equal(typeof raw, "string");
  const output = JSON.parse(raw);
  assert.equal(output.contract_version, "phase3.strategist-output.v2");
  assert.equal(output.status, "ok");
  assert.equal(typeof output.positioning, "string");
  assert.ok(output.positioning.trim());
  assert.ok(Array.isArray(output.key_messages));
  assert.ok(output.key_messages.length >= 3 && output.key_messages.length <= 5);
  assert.equal(Object.hasOwn(output, "channels"), false);
  assert.ok(output.posting_cadence && typeof output.posting_cadence === "object");
  const channels = Object.keys(output.posting_cadence).sort();
  assert.ok(channels.length > 0);
  for (const channel of channels) {
    assert.deepEqual(Object.keys(output.posting_cadence[channel]), ["posts_per_week"]);
    const value = output.posting_cadence[channel].posts_per_week;
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 14);
  }
  assert.ok(Array.isArray(output.content_pillars));
  assert.ok(output.content_pillars.length >= 4 && output.content_pillars.length <= 8);
  const canonical = {
    ...output,
    contract_version: "phase3.strategist-output.v1",
    channels,
  };
  assert.equal(canonical.contract_version, "phase3.strategist-output.v1");
  assert.deepEqual(canonical.channels, Object.keys(canonical.posting_cadence).sort());
  console.log(`PROBE_CHANNELS=${channels.length}`);
  console.log(`PROBE_PILLARS=${output.content_pillars.length}`);
  console.log("PASS: Gemma probe output has one channel source and normalizes deterministically.");
} else {
  console.error("usage: probe-contract.mjs build WORKFLOW CLAIMED OUTPUT | validate RESPONSE");
  process.exit(2);
}
