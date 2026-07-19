import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const contract = join(root, "deployment", "phase6-core-agent-canary", "scripts", "workflow-contract.mjs");
const source = join(root, "n8n", "workflows", "phase3");

function run(args, expectSuccess = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [contract, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code === 0) === expectSuccess) resolve(output);
      else reject(new Error(`workflow contract exited ${code}\n${output}`));
    });
  });
}

test("core canary workflow contract disables schedules, restores originals, and detects unrelated drift", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "tanaghom-core-contract-"));
  try {
    const strategist = JSON.parse(await readFile(join(source, "campaign-strategist.v1.json"), "utf8"));
    const producer = JSON.parse(await readFile(join(source, "content-producer.v1.json"), "utf8"));
    const unrelated = { id: "unrelatedFixtureV1", name: "Unrelated fixture", active: false, nodes: [], connections: {}, settings: {} };
    const beforePath = join(temporary, "before.json");
    const prepared = join(temporary, "prepared");
    await writeFile(beforePath, JSON.stringify([strategist, producer, unrelated]));
    await run(["prepare", beforePath, source, prepared]);

    const strategistCanary = JSON.parse(await readFile(join(prepared, "phase3StrategistV1.canary.json"), "utf8"))[0];
    const producerCanary = JSON.parse(await readFile(join(prepared, "phase3ContentProducerV1.canary.json"), "utf8"))[0];
    for (const workflow of [strategistCanary, producerCanary]) {
      assert.equal(workflow.active, false);
      assert.equal(workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger")?.disabled, true);
    }

    const canaryPath = join(temporary, "canary.json");
    await writeFile(canaryPath, JSON.stringify([strategistCanary, producerCanary, unrelated]));
    await run(["verify", canaryPath, join(prepared, "workflow-manifest.json"), "canary"]);
    await run(["verify", beforePath, join(prepared, "workflow-manifest.json"), "original"]);
    await run(["compare-others", beforePath, canaryPath]);

    const driftedPath = join(temporary, "drifted.json");
    await writeFile(driftedPath, JSON.stringify([strategistCanary, producerCanary, { ...unrelated, name: "Changed" }]));
    const drift = await run(["compare-others", beforePath, driftedPath], false);
    assert.match(drift, /non-canary n8n workflow changed/);

    const unsafePath = join(temporary, "unsafe.json");
    const unsafe = structuredClone(strategist);
    unsafe.nodes.find((node) => node.name === "Call Gemma").parameters.url = "https://example.invalid";
    await writeFile(unsafePath, JSON.stringify([unsafe, producer, unrelated]));
    const unsafeOutput = await run(["prepare", unsafePath, source, join(temporary, "unsafe")], false);
    assert.match(unsafeOutput, /unexpected external endpoint/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
