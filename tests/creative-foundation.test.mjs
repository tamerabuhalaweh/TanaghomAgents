import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const loadSchema = (name) => JSON.parse(readFileSync(`${rootPath}packages/contracts/schemas/creative/${name}.v1.schema.json`, "utf8"));

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validators = new Map();
const validateSchema = (name, payload) => {
  if (!validators.has(name)) validators.set(name, ajv.compile(loadSchema(name)));
  return validators.get(name)(payload);
};

const validJobRequest = {
  contract_version: "creative.create-job-request.v1",
  capability: "image",
  lane: "cpu",
  params: { prompt: "red square" },
  idempotency_key: "11111111-0000-4000-8000-000000000001",
  correlation_id: "22222222-0000-4000-8000-000000000002",
};

test("creative migration 0036 is additive, guarded, and fully reversible", async () => {
  const up = await read("packages/database/migrations/0036_creative_foundation.up.sql");
  const down = await read("packages/database/migrations/0036_creative_foundation.down.sql");
  assert.match(up, /0036 requires exact 0035 baseline/);
  for (const table of ["creative_controls", "creative_jobs", "creative_job_transitions", "creative_assets",
    "creative_asset_versions", "creative_templates", "brand_kits", "brand_kit_versions", "creative_events"]) {
    assert.match(up, new RegExp(`CREATE TABLE tanaghom\\.${table} \\(`));
  }
  assert.match(up, /CREATE ROLE tanaghom_creative_worker NOLOGIN/);
  assert.match(up, /FOR UPDATE OF job SKIP LOCKED/);
  assert.match(up, /TO tanaghom_creative_worker/);
  assert.match(up, /TO tanaghom_api, tanaghom_readonly/);
  assert.match(up, /INSERT INTO public.schema_migrations\(version\) VALUES \('0036_creative_foundation'\)/);
  assert.match(down, /creative rollback refuses retained jobs/);
  assert.match(down, /DELETE FROM public.schema_migrations WHERE version='0036_creative_foundation'/);
  // Every granted worker function is dropped by name with an exact signature.
  for (const signature of ["claim_creative_job(text,text,int)", "mark_creative_job_running(uuid,text)",
    "heartbeat_creative_job(uuid,text,int)", "complete_creative_job(uuid,text,uuid,int)",
    "fail_creative_job(uuid,text,text,text,int)", "expire_creative_leases()",
    "create_creative_asset_version(uuid,text,uuid,text,text,int,int,int,bigint,text,text,text,jsonb,text,text,text)"]) {
    assert.match(up, new RegExp(`CREATE FUNCTION tanaghom.${signature.replace(/\(.*/, "\\(")}`));
    assert.match(down, new RegExp(`DROP FUNCTION tanaghom\\.${signature.replace(/[()]/g, (c) => `\\${c}`)};`));
  }
});

test("creative contracts accept valid payloads and reject invalid states", async () => {
  const cases = {
    "create-job-request": [validJobRequest, true],
    "job-record": [{
      contract_version: "creative.job-record.v1", job_id: validJobRequest.idempotency_key,
      organization_id: validJobRequest.correlation_id, capability: "image", lane: "cpu",
      status: "queued", attempt: 0, max_attempts: 3, correlation_id: validJobRequest.correlation_id,
      idempotency_key: validJobRequest.idempotency_key,
    }, true],
    "worker-claim": [{ contract_version: "creative.worker-claim.v1", lane: "cpu", worker: "w", lease_seconds: 120 }, true],
    "worker-completion": [{ contract_version: "creative.worker-completion.v1", job_id: validJobRequest.idempotency_key, worker: "w", asset_version_id: validJobRequest.correlation_id }, true],
    "worker-failure": [{ contract_version: "creative.worker-failure.v1", job_id: validJobRequest.idempotency_key, worker: "w", error_class: "transient", error_message: "x" }, true],
    "asset-metadata": [{ contract_version: "creative.asset-metadata.v1", asset_id: validJobRequest.idempotency_key, organization_id: validJobRequest.correlation_id, capability: "image", originating_job_id: validJobRequest.idempotency_key }, true],
    "asset-version-metadata": [{ contract_version: "creative.asset-version-metadata.v1", asset_version_id: validJobRequest.idempotency_key, asset_id: validJobRequest.idempotency_key, version: 1, job_id: validJobRequest.idempotency_key, mime: "image/png", bytes: 64, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", object_key: "t/o/image/a/v1.png", method: "mock", status: "draft" }, true],
    "brand-kit-snapshot": [{ contract_version: "creative.brand-kit-snapshot.v1", kit_id: validJobRequest.idempotency_key, version: 1, organization_id: validJobRequest.correlation_id }, true],
    "adapter-envelope": [{ contract_version: "creative.adapter-envelope.v1", adapter: "mock", kind: "request", capability: "image" }, true],
  };
  for (const [name, [valid, expected]] of Object.entries(cases)) {
    assert.equal(validateSchema(name, valid), expected, `${name} rejected a valid payload`);
  }
  const invalid = [
    ["create-job-request", { ...validJobRequest, capability: "hologram" }],
    ["create-job-request", { ...validJobRequest, lane: "tpu" }],
    ["create-job-request", { ...validJobRequest, extra: true }],
    ["job-record", { contract_version: "creative.job-record.v1", status: "published" }],
    ["worker-claim", { contract_version: "creative.worker-claim.v1", lane: "cpu", worker: "w", lease_seconds: 5 }],
    ["worker-failure", { contract_version: "creative.worker-failure.v1", job_id: validJobRequest.idempotency_key, worker: "w", error_class: "mystery", error_message: "x" }],
    ["asset-version-metadata", { contract_version: "creative.asset-version-metadata.v1" }],
    ["adapter-envelope", { contract_version: "creative.adapter-envelope.v1", adapter: "comfyui", kind: "request" }],
  ];
  for (const [name, payload] of invalid) {
    assert.equal(validateSchema(name, payload), false, `${name} accepted invalid payload`);
  }
});

test("creative runtime vocabulary, registry, and queue policy are closed", async () => {
  const capabilities = await import("../packages/creative-runtime/capabilities.mjs");
  assert.deepStrictEqual([...capabilities.LANES], ["cpu", "gpu_image", "gpu_video", "gpu_audio"]);
  assert.ok(capabilities.isTerminalStatus("expired"));
  assert.ok(!capabilities.isTerminalStatus("running"));
  assert.ok(capabilities.isRetryableErrorClass("transient"));
  assert.ok(!capabilities.isRetryableErrorClass("deterministic"));

  const registry = await import("../packages/creative-runtime/registry.mjs");
  registry.clearAdapters();
  const { mockAdapter } = await import("../packages/creative-runtime/adapters/mock.mjs");
  assert.equal(registry.registerAdapter(mockAdapter), "mock");
  assert.throws(() => registry.registerAdapter(mockAdapter), /already_registered/);
  const stored = registry.getAdapter("mock");
  assert.equal(stored.name, "mock");
  assert.equal(typeof stored.execute, "function");
  assert.ok(stored.capabilities.includes("image"));
  assert.throws(() => registry.getAdapter("comfyui"), /unknown_adapter/);
  assert.equal(registry.adaptersFor("image").length, 1);
  assert.equal(registry.adaptersFor("hologram").length, 0);
  registry.clearAdapters();

  const queue = await import("../packages/creative-runtime/queue.mjs");
  assert.equal(queue.backoffMs(1), 1000);
  assert.equal(queue.backoffMs(3), 4000);
  assert.equal(queue.backoffMs(99), 60000);
  assert.equal(queue.nextStatusAfterFailure("transient", 1, 3), "queued");
  assert.equal(queue.nextStatusAfterFailure("transient", 3, 3), "failed");
  assert.equal(queue.nextStatusAfterFailure("deterministic", 1, 3), "failed");
  assert.equal(queue.nextStatusAfterFailure("policy", 1, 3), "failed");
  assert.equal(queue.nextStatusAfterFailure("cancelled", 1, 3), "cancelled");
  assert.equal(queue.shouldHonorCancel("running", true), true);
  assert.equal(queue.shouldHonorCancel("succeeded", true), false);
  assert.equal(queue.shouldHonorCancel("queued", false), false);
});

test("mock adapter is deterministic and classifies scripted outcomes", async () => {
  const { mockExecute, MOCK_ADAPTER_NAME } = await import("../packages/creative-runtime/adapters/mock.mjs");
  assert.equal(MOCK_ADAPTER_NAME, "mock");
  const input = { capability: "image", jobId: "11111111-0000-4000-8000-000000000001", params: { prompt: "x" }, organizationId: "22222222-0000-4000-8000-000000000002" };
  const first = await mockExecute(input);
  const second = await mockExecute(input);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.mime, "image/png");
  assert.equal(first.method, "mock");
  for (const errorClass of ["transient", "deterministic", "capacity", "policy"]) {
    await assert.rejects(
      mockExecute({ ...input, params: { mock: { outcome: errorClass } } }),
      (error) => error.errorClass === errorClass,
    );
  }
  await assert.rejects(mockExecute({ ...input, params: { mock: { outcome: "weird" } } }), /unknown mock outcome/);
  await assert.rejects(mockExecute({ capability: "image" }), /requires capability, jobId/);
});

test("storage keys are tenant-scoped and checksums/previews verify", async () => {
  const keys = await import("../packages/creative-runtime/storage/keys.mjs");
  const key = keys.buildObjectKey({
    organizationId: "71000000-0000-4000-8000-000000000001",
    capability: "image",
    assetId: "74000000-0000-4000-8000-000000000001",
    version: 2,
    mime: "image/png",
  });
  assert.equal(key, "t/71000000-0000-4000-8000-000000000001/image/74000000-0000-4000-8000-000000000001/v2.png");
  const parsed = keys.parseObjectKey(key);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.mime, "image/png");
  assert.throws(() => keys.parseObjectKey("https://cdn.example.test/x.png"), /invalid_object_key/);
  assert.throws(() => keys.buildObjectKey({ organizationId: "x", capability: "image", assetId: "y", version: 1, mime: "image/png" }), /invalid_organization_id/);
  assert.throws(() => keys.buildObjectKey({ organizationId: "71000000-0000-4000-8000-000000000001", capability: "image", assetId: "74000000-0000-4000-8000-000000000001", version: 1, mime: "application/pdf" }), /unsupported_mime/);
  const bytes = Buffer.from("deterministic-bytes");
  const hex = keys.sha256Hex(bytes);
  assert.ok(keys.verifyChecksum(bytes, hex));
  assert.equal(keys.verifyChecksum(bytes, "0".repeat(64)), false);
  assert.equal(keys.verifyChecksum(Buffer.from("other"), hex), false);
  const secret = "preview-secret-at-least-32-characters!!";
  const { token } = keys.previewToken({ secret, objectKey: key, expiresAt: new Date(Date.now() + 600000).toISOString() });
  assert.ok(keys.verifyPreviewToken({ secret, objectKey: key, token }));
  assert.equal(keys.verifyPreviewToken({ secret, objectKey: "t/other/image/a/v1.png", token }), false);
  assert.equal(keys.verifyPreviewToken({ secret, objectKey: key, token: `${token}tampered` }), false);
  assert.throws(() => keys.previewToken({ secret: "short", objectKey: key, expiresAt: new Date().toISOString() }), /too_short/);
});

test("test storage adapter stores privately with checksum and preview guards", async () => {
  const { createTestStorage } = await import("../packages/creative-runtime/storage/test-adapter.mjs");
  const store = createTestStorage();
  const bytes = Buffer.from("artifact-bytes");
  const stored = store.put({ key: "t/org/image/a/v1.png", bytes, mime: "image/png" });
  assert.ok(store.has("t/org/image/a/v1.png"));
  assert.equal(store.get("t/org/image/a/v1.png").sha256, stored.sha256);
  assert.ok(store.verifyStored("t/org/image/a/v1.png", stored.sha256));
  assert.throws(() => store.put({ key: "t/org/image/a/v1.png", bytes, mime: "image/png" }), /immutable/);
  assert.throws(() => store.put({ key: "", bytes, mime: "image/png" }), /object_key_required/);
  assert.throws(() => store.signPreview("t/org/image/a/v1.png", 10), /invalid_preview_ttl/);
  const preview = store.signPreview("t/org/image/a/v1.png", 900);
  assert.equal(preview.previewOnly, true);
  assert.ok(preview.url.startsWith("test-preview://"));
  assert.doesNotMatch(preview.url, /^https?:\/\//);
  assert.equal(store.remove("t/org/image/a/v1.png").deleted, true);
  assert.equal(store.has("t/org/image/a/v1.png"), false);
  assert.throws(() => createTestStorage({ secret: "short" }), /too_short/);
});

test("creative server boundary stays authenticated, authorized, idempotent, and provider-free", async () => {
  const jobs = await read("apps/dashboard/lib/server/creative/jobs.ts");
  const assets = await read("apps/dashboard/lib/server/creative/assets.ts");
  const control = await read("apps/dashboard/lib/server/creative/feature-control.ts");
  const idempotency = await read("apps/dashboard/lib/server/creative/idempotency.ts");
  for (const source of [jobs, assets]) {
    assert.match(source, /requireCreativeStudio\(\)/);
    assert.match(source, /authorize\(request, \[/);
    assert.match(source, /tanaghom\.create_creative_|tanaghom\.request_creative_cancel|tanaghom\.decide_creative_asset_version/);
    assert.match(source, /agent_actions_log/);
    assert.doesNotMatch(source, /fetch\(|https?:\/\/|comfyui|openai|anthropic|replicate|fal\.ai|sharp\(/i);
  }
  assert.match(control, /CREATIVE_STUDIO_ENABLED.*=== "true"/);
  assert.match(control, /creative_studio_disabled/);
  assert.match(idempotency, /idempotency_key_reused/);
  assert.match(jobs, /Idempotency-Replayed/);
  assert.match(jobs, /authorize\(request, \["owner", "operator"\]\)/);
  assert.match(assets, /authorize\(request, \["owner", "reviewer"\]\)/);
  for (const route of [
    "apps/dashboard/app/api/creative/jobs/route.ts",
    "apps/dashboard/app/api/creative/jobs/[id]/route.ts",
    "apps/dashboard/app/api/creative/jobs/[id]/cancel/route.ts",
    "apps/dashboard/app/api/creative/assets/route.ts",
    "apps/dashboard/app/api/creative/assets/versions/[id]/route.ts",
    "apps/dashboard/app/api/creative/assets/versions/[id]/decision/route.ts",
  ]) {
    const source = await read(route);
    assert.match(source, /export const runtime = "nodejs"/);
    assert.match(source, /apiFailure\(error\)/);
  }
  const envExample = await read(".env.example");
  assert.match(envExample, /CREATIVE_STUDIO_ENABLED=false/);
});
