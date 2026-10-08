import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const loadJson = (path) => JSON.parse(readFileSync(`${rootPath}${path}`, "utf8"));

test("creative image lane migration is additive, guarded, and reversible", async () => {
  const up = await read("packages/database/migrations/0038_creative_image_lane.up.sql");
  const down = await read("packages/database/migrations/0038_creative_image_lane.down.sql");
  assert.match(up, /0038 requires exact 0037 baseline/);
  assert.match(up, /CREATE TABLE tanaghom\.creative_provider_calls \(/);
  assert.match(up, /CREATE TABLE tanaghom\.creative_fidelity_reviews \(/);
  assert.match(up, /ADD COLUMN fidelity_status/);
  assert.match(up, /UNIQUE\(job_id,attempt_no\)/);
  assert.match(up, /TO tanaghom_creative_worker/);
  assert.match(up, /INSERT INTO public\.schema_migrations\(version\) VALUES \('0038_creative_image_lane'\)/);
  assert.match(down, /refuses retained provider or fidelity evidence/);
  assert.match(down, /DELETE FROM public.schema_migrations WHERE version='0038_creative_image_lane'/);
  assert.doesNotMatch(up, /CREATE TABLE tanaghom\.credit/i);
  assert.doesNotMatch(up, /billing/i);
});

test("image generation and fidelity contracts validate", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const gen = loadJson("packages/contracts/schemas/creative/image-generation-request.v1.schema.json");
  const validateGen = ajv.compile(gen);
  const good = {
    contract_version: "creative.image-generation-request.v1", capability: "image",
    prompt: "red square", width: 1024, height: 1024, variants: 2,
    idempotency_key: "11111111-0000-4000-8000-000000000001",
    correlation_id: "22222222-0000-4000-8000-000000000002",
  };
  assert.equal(validateGen(good), true);
  assert.equal(validateGen({ ...good, variants: 5 }), false);
  assert.equal(validateGen({ ...good, capability: "video" }), false);
  assert.equal(validateGen({ ...good, prompt: "" }), false);
  assert.equal(validateGen({ ...good, extra: 1 }), false);
  const fid = loadJson("packages/contracts/schemas/creative/fidelity-review.v1.schema.json");
  const validateFid = ajv.compile(fid);
  const review = {
    contract_version: "creative.fidelity-review.v1",
    asset_version_id: "11111111-0000-4000-8000-000000000001",
    overall: "failed",
    checklist: { logo: "pass", package_text: "fail", shape: "pass", proportions: "pass", primary_colors: "pass", markings: "unreviewed" },
  };
  assert.equal(validateFid(review), true);
  assert.equal(validateFid({ ...review, overall: "maybe" }), false);
  assert.equal(validateFid({ ...review, checklist: { logo: "ok" } }), false);
});

test("provider allowlist and presets are versioned, bounded, and commercial-clean", async () => {
  const providers = loadJson("config/creative-providers.v1.json");
  assert.equal(providers.contract_version, "creative.providers.v1");
  const schnell = providers.adapters["http-image"].allowlist[0];
  assert.equal(schnell.model, "fal-ai/flux/schnell");
  assert.equal(schnell.weights_license, "Apache-2.0");
  assert.equal(schnell.commercial, true);
  assert.equal(schnell.unit_price_usd, 0.003);
  const blocked = providers.adapters["http-image"].blocked.map((entry) => entry.model);
  assert.ok(blocked.some((model) => model.includes("flux/dev")));
  const presets = loadJson("config/creative-image-presets.v1.json");
  assert.equal(presets.contract_version, "creative.image-presets.v1");
  const codes = presets.presets.map((preset) => preset.code);
  assert.deepEqual([...codes].sort(), ["clean_white", "marble", "office_studio", "outdoor_lifestyle", "wood"]);
  for (const preset of presets.presets) {
    assert.ok(preset.output.width >= 64 && preset.output.width <= 2048);
    assert.ok(["solid", "gradient"].includes(preset.background.kind));
  }
  const corpus = loadJson("evaluation/creative-image-v1/corpus.json");
  assert.equal(corpus.contract_version, "creative.evaluation-corpus.v1");
  assert.equal(new Set(corpus.cases.map((c) => c.id)).size, corpus.cases.length);
  assert.ok(corpus.cases.some((c) => c.language === "ar"));
  assert.ok(corpus.cases.some((c) => c.kind === "negative"));
});

test("http image adapter normalizes, allowlists, and classifies without network", async () => {
  const http = await import("../packages/creative-runtime/adapters/http-image.mjs");
  const good = http.normalizeImageRequest({ prompt: "red square", width: 1024, height: 1024, variants: 2 });
  assert.equal(good.variants, 2);
  assert.throws(() => http.normalizeImageRequest({ prompt: "", width: 1024, height: 1024, variants: 1 }), /prompt/);
  assert.throws(() => http.normalizeImageRequest({ prompt: "x", width: 64, height: 1024, variants: 1 }), /width/);
  assert.throws(() => http.normalizeImageRequest({ prompt: "x", width: 1024, height: 1024, variants: 9 }), /variants/);
  const providers = loadJson("config/creative-providers.v1.json");
  const entry = http.assertAllowlisted(providers.adapters["http-image"].allowlist, "fal-ai/flux/schnell");
  assert.equal(entry.unit_price_usd, 0.003);
  assert.throws(() => http.assertAllowlisted(providers.adapters["http-image"].allowlist, "fal-ai/flux/dev"), /not allowlisted/);
  assert.throws(() => http.createHttpImageAdapter({ name: "x", endpoint: "http://insecure", apiKey: "k", model: "m" }), /https/);

  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    const mode = new URL(url, "http://stub").searchParams.get("fault") ?? new URL(url).pathname.split("/").pop();
    return stubProviderResponse(url, init, mode);
  };
  function stubProviderResponse(url, init, mode) {
    const json = (status, payload, headers = {}) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    });
    if (mode === "rate_limit") return json(429, { error: "slow down" });
    if (mode === "broken") return json(500, { error: "boom" });
    if (mode === "rejected") return json(400, { error: "bad prompt" });
    if (mode === "malformed") return json(200, "not-json{{{");
    if (mode === "empty") return json(200, { images: [] });
    if (mode === "slow") {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    return json(200, { images: [{ url: "https://cdn.stub/i.png", content_type: "image/png" }] }, { "x-fal-request-id": "stub-1" });
  }
  const adapter = http.createHttpImageAdapter({
    name: "stub-schnell", endpoint: "https://stub.test/ok", apiKey: "stub-key",
    model: "fal-ai/flux/schnell", modelVersion: "test", timeoutMs: 5000, fetchImpl: stubFetch,
  });
  const result = await adapter.execute({ prompt: "red square", width: 512, height: 512, variants: 1 });
  assert.equal(result.images.length, 1);
  assert.equal(result.requestId, "stub-1");
  assert.equal(result.model, "fal-ai/flux/schnell");
  for (const [mode, errorClass] of [["rate_limit", "capacity"], ["broken", "transient"], ["rejected", "deterministic"]]) {
    const failing = http.createHttpImageAdapter({
      name: `stub-${mode}`, endpoint: `https://stub.test/${mode}`, apiKey: "k",
      model: "fal-ai/flux/schnell", timeoutMs: 5000, fetchImpl: stubFetch,
    });
    await assert.rejects(failing.execute({ prompt: "x", width: 512, height: 512, variants: 1 }),
      (error) => error.errorClass === errorClass);
  }
  const malformed = http.createHttpImageAdapter({
    name: "stub-malformed", endpoint: "https://stub.test/malformed", apiKey: "k",
    model: "fal-ai/flux/schnell", timeoutMs: 5000, fetchImpl: stubFetch,
  });
  await assert.rejects(malformed.execute({ prompt: "x", width: 512, height: 512, variants: 1 }),
    (error) => error.errorClass === "deterministic");
  const empty = http.createHttpImageAdapter({
    name: "stub-empty", endpoint: "https://stub.test/empty", apiKey: "k",
    model: "fal-ai/flux/schnell", timeoutMs: 5000, fetchImpl: stubFetch,
  });
  await assert.rejects(empty.execute({ prompt: "x", width: 512, height: 512, variants: 1 }),
    (error) => error.errorClass === "deterministic");
  const slow = http.createHttpImageAdapter({
    name: "stub-slow", endpoint: "https://stub.test/slow", apiKey: "k",
    model: "fal-ai/flux/schnell", timeoutMs: 50, fetchImpl: stubFetch,
  });
  await assert.rejects(slow.execute({ prompt: "x", width: 512, height: 512, variants: 1 }),
    (error) => error.errorClass === "indeterminate");
  await assert.rejects(http.downloadArtifact({ url: "ftp://evil/x.png", fetchImpl: stubFetch }), /http\(s\)/);
});

test("review round: ssrf guard, attempt lifecycle, version truth, operation truth, chroma segment", async () => {
  const http = await import("../packages/creative-runtime/adapters/http-image.mjs");
  const allow = { allowedOrigins: ["fal.media"] };
  // Allowlisted public host passes (no network: validator only).
  assert.deepEqual(http.validateArtifactUrl("https://v3.fal.media/files/a/b.png", allow).host, "v3.fal.media");
  assert.deepEqual(http.validateArtifactUrl("https://fal.media/files/a.png", allow).host, "fal.media");
  // Rejections: loopback, private, metadata, userinfo, non-allowlisted, bad scheme.
  for (const bad of [
    "http://127.0.0.1:43223/artifact.png",
    "http://localhost:43223/artifact.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/x.png",
    "http://192.168.1.2/x.png",
    "http://172.20.0.9/x.png",
    "http://0.0.0.0/x.png",
    "https://user:pass@fal.media/x.png",
    "https://example.com/x.png",
    "ftp://fal.media/x.png",
    "not-a-url",
  ]) {
    assert.throws(() => http.validateArtifactUrl(bad, allow), /not retrievable|not allowlisted|malformed|credentials|scheme|must be https/, bad);
  }
  // Explicit test loopback mode permits loopback only — never private/metadata.
  assert.deepEqual(http.validateArtifactUrl("http://127.0.0.1:43223/a.png", { allowedOrigins: [], testLoopback: true }).host, "127.0.0.1");
  assert.throws(() => http.validateArtifactUrl("http://169.254.169.254/x", { allowedOrigins: [], testLoopback: true }), /not retrievable/);
  assert.throws(() => http.validateArtifactUrl("https://example.com/x.png", { allowedOrigins: [], testLoopback: true }), /not allowlisted/);
  // Redirects revalidate: a redirect to a private host is refused without connecting to it.
  const seen = [];
  const pinnedRedirect = async ({ url }) => {
    seen.push(url);
    if (url === "https://fal.media/start.png") {
      return { status: 302, headers: { get: (name) => (name === "location" ? "http://169.254.169.254/evil" : null) } };
    }
    throw new Error(`unexpected connection ${url}`);
  };
  await assert.rejects(
    http.downloadArtifact({
      url: "https://fal.media/start.png", allowedOrigins: ["fal.media"], testLoopback: false,
      resolveHost: async () => ["93.184.216.34"], pinnedRequest: pinnedRedirect,
    }),
    /not retrievable/,
  );
  assert.deepEqual(seen, ["https://fal.media/start.png"]);
  // Over-long redirect chains are refused.
  const loopPinned = async () => ({ status: 302, headers: { get: (name) => (name === "location" ? "https://fal.media/next.png" : null) } });
  await assert.rejects(
    http.downloadArtifact({
      url: "https://fal.media/a.png", allowedOrigins: ["fal.media"],
      resolveHost: async () => ["93.184.216.34"], pinnedRequest: loopPinned,
    }),
    /redirect chain too long/,
  );

  // Attempt lifecycle is begin/finish shaped; no invented versions; ops truthful.
  const up = await read("packages/database/migrations/0038_creative_image_lane.up.sql");
  assert.match(up, /CREATE FUNCTION tanaghom\.begin_creative_provider_call\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.finish_creative_provider_call\(/);
  assert.match(up, /attempt already terminal/);
  assert.match(up, /FOR UPDATE/);
  assert.doesNotMatch(up, /record_creative_provider_call/);
  const down = await read("packages/database/migrations/0038_creative_image_lane.down.sql");
  assert.match(down, /DROP FUNCTION tanaghom\.begin_creative_provider_call/);
  assert.match(down, /DROP FUNCTION tanaghom\.finish_creative_provider_call/);
  assert.doesNotMatch(down, /record_creative_provider_call/);
  const providers = loadJson("config/creative-providers.v1.json");
  const schnell = providers.adapters["http-image"].allowlist[0];
  assert.deepEqual(schnell.operations, ["text_to_image"]);
  assert.equal(schnell.model_version, null);
  assert.equal(schnell.adapter_config_version, "creative.providers.v1");
  assert.deepEqual(schnell.artifact_origins, ["fal.media"]);
  for (const path of [
    "config/creative-providers.v1.json",
    "docs/planning/creative-platform/tasks/229-provider-decision.md",
    "scripts/creative-image-integration.mjs",
    "packages/database/tests/creative_image_lane.sql",
  ]) {
    assert.doesNotMatch(await read(path), /schnell-20260414/, path);
  }

  // Chroma-key segmentation boundary is real and deterministic.
  const sharp = await import("../packages/creative-runtime/adapters/local-sharp.mjs");
  const greenRaw = await (await import("sharp")).default({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer();
  const cut = await sharp.segmentChroma({ bytes: greenRaw, keyColor: "#00ff00", tolerance: 10 });
  const cutRaw = await (await import("sharp")).default(cut.bytes).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < cutRaw.length; i += 4) assert.equal(cutRaw[i], 0);
  assert.equal(cut.provenance.method, "chroma-key");
  const redRaw = await (await import("sharp")).default({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const kept = await sharp.segmentChroma({ bytes: redRaw, keyColor: "#00ff00", tolerance: 10 });
  const keptRaw = await (await import("sharp")).default(kept.bytes).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < keptRaw.length; i += 4) assert.equal(keptRaw[i], 255);
  await assert.rejects(sharp.segmentChroma({ bytes: redRaw, keyColor: "#00ff00", tolerance: 999 }), /tolerance/);
  const viaAdapter = await sharp.localSharpAdapter.execute({ operation: "segment", bytes: greenRaw });
  assert.equal(viaAdapter.provenance.operation, "segment");
});

test("local sharp pipeline renders, composes, and enhances deterministically", async () => {
  const sharp = await import("../packages/creative-runtime/adapters/local-sharp.mjs");
  const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const first = await sharp.composeScene({
    foregroundBytes: png1x1,
    preset: { code: "clean_white", background: { kind: "solid", color: "#ffffff" }, relight: { brightness: 1.05, saturation: 1 }, output: { width: 256, height: 256 } },
  });
  const second = await sharp.composeScene({
    foregroundBytes: png1x1,
    preset: { code: "clean_white", background: { kind: "solid", color: "#ffffff" }, relight: { brightness: 1.05, saturation: 1 }, output: { width: 256, height: 256 } },
  });
  assert.equal(first.width, 256);
  assert.equal(first.mime, "image/png");
  assert.equal(createHash("sha256").update(first.bytes).digest("hex"), createHash("sha256").update(second.bytes).digest("hex"));
  assert.equal(first.provenance.adapter, "local-sharp");
  const enhanced = await sharp.enhanceImage({ bytes: first.bytes, scale: 2 });
  assert.equal(enhanced.width, 512);
  assert.equal(enhanced.provenance.kernel, "lanczos3");
  const probed = await sharp.probeImage(first.bytes);
  assert.equal(probed.format, "png");
  await assert.rejects(sharp.composeScene({ foregroundBytes: png1x1, preset: { code: "x", output: { width: 8, height: 8 } } }), /dimensions|preset/);
  await assert.rejects(sharp.enhanceImage({ bytes: png1x1, scale: 3 }), /scale/);
  await assert.rejects(sharp.composeScene({
    foregroundBytes: png1x1,
    preset: { code: "x", background: { kind: "solid", color: "#ffffff" }, relight: { brightness: 99, saturation: 1 }, output: { width: 256, height: 256 } },
  }), /relight/);
});

test("s3 adapter signs deterministically and round-trips objects", async () => {
  const s3 = await import("../packages/creative-runtime/storage/s3.mjs");
  assert.throws(() => s3.createS3Storage({ endpoint: "http://s3.test", region: "us-east-1", bucket: "b" }), /incomplete/);
  const store = s3.createS3Storage({
    endpoint: "http://s3.test", region: "us-east-1", bucket: "test-bucket",
    accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  });
  const key = "t/71000000-0000-4000-8000-000000000001/image/74000000-0000-4000-8000-000000000001/v1.png";
  const seen = [];
  const stubFetch = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.Authorization });
    if (!String(init.headers.Authorization).startsWith("AWS4-HMAC-SHA256 ")) throw new Error("unsigned");
    if (init.method === "PUT") return { status: 200, headers: { get: () => '"etag-1"' } };
    if (init.method === "GET") {
      return { status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    if (init.method === "DELETE") return { status: 204, headers: { get: () => null } };
    throw new Error("unexpected-method");
  };
  const wired = s3.createS3Storage({
    endpoint: "http://s3.test", region: "us-east-1", bucket: "test-bucket",
    accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", fetchImpl: stubFetch,
  });
  const put = await wired.put(key, Buffer.from([1, 2, 3]), "image/png");
  assert.equal(put.bytes, 3);
  const got = await wired.get(key);
  assert.deepEqual(Buffer.from(got.bytes), Buffer.from([1, 2, 3]));
  assert.equal((await wired.remove(key)).deleted, true);
  await assert.rejects(wired.put(key, Buffer.alloc(0), "image/png"), /bytes_required/);
  await assert.rejects(wired.put("https://evil/x.png", Buffer.from([1]), "image/png"), /shape_violation/);
  await assert.rejects(wired.put(key, Buffer.from([1]), "application/pdf"), /mismatch/);
  const p1 = wired.presignGet(key, 900, new Date("2026-10-08T00:00:00Z"));
  const p2 = wired.presignGet(key, 900, new Date("2026-10-08T00:00:00Z"));
  assert.equal(p1.url, p2.url);
  assert.ok(p1.url.includes("X-Amz-Signature="));
  assert.equal(p1.previewOnly, true);
  assert.throws(() => wired.presignGet(key, 30), /ttl/);
  // Independent SigV4 recomputation pins the construction (not just determinism).
  const { createHash: nodeHash, createHmac: nodeHmac } = await import("node:crypto");
  const fixedNow = new Date("2026-10-08T00:00:00Z");
  const presigned = wired.presignGet(key, 900, fixedNow);
  const parsed = new URL(presigned.url);
  const query = new URLSearchParams(parsed.search);
  const signature = query.get("X-Amz-Signature");
  query.delete("X-Amz-Signature");
  const sorted = new URLSearchParams([...query.entries()].sort());
  const canonical = ["GET", parsed.pathname,
    sorted.toString().replace(/\+/g, "%20"),
    `host:${parsed.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stamp = query.get("X-Amz-Date");
  const dateStamp = stamp.slice(0, 8);
  const scope = `${dateStamp}/us-east-1/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, nodeHash("sha256").update(canonical).digest("hex")].join("\n");
  const kDate = nodeHmac("sha256", "AWS4wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY").update(dateStamp).digest();
  const kRegion = nodeHmac("sha256", kDate).update("us-east-1").digest();
  const kService = nodeHmac("sha256", kRegion).update("s3").digest();
  const kSigning = nodeHmac("sha256", kService).update("aws4_request").digest();
  assert.equal(nodeHmac("sha256", kSigning).update(toSign).digest("hex"), signature);
  void store;
});

test("artifact downloads pin resolved public destinations; loopback needs test mode", async () => {
  const http = await import("../packages/creative-runtime/adapters/http-image.mjs");
  // IP classification matrix.
  for (const [ip, verdict] of [
    ["127.0.0.1", "loopback"], ["::1", "loopback"], ["10.0.0.5", "rfc1918"],
    ["172.20.0.9", "rfc1918"], ["192.168.1.2", "rfc1918"], ["169.254.169.254", "link-local"],
    ["0.0.0.0", "unspecified"], ["::", "unspecified"], ["fe80::1", "link-local"],
    ["fc00::1", "ula"], ["fd00::1", "ula"], ["ff02::1", "multicast"],
    ["100.64.0.1", "cgnat"], ["192.0.2.1", "reserved"], ["198.51.100.7", "reserved"],
    ["203.0.113.9", "documentation"], ["224.0.0.1", "multicast"],
    ["::ffff:127.0.0.1", "loopback"], ["::ffff:10.1.2.3", "rfc1918"],
    ["93.184.216.34", "public"], ["2606:2800:220:1:248:1893:25c8:1946", "public"],
  ]) {
    assert.equal(http.classifyIp(ip), verdict, ip);
  }
  // Allowlisted hostname resolving to loopback/private/metadata is refused.
  for (const [answers, label] of [
    [["127.0.0.1"], "loopback-answer"],
    [["10.8.0.1"], "rfc1918-answer"],
    [["169.254.169.254"], "metadata-answer"],
  ]) {
    await assert.rejects(
      http.resolveAndPin("v3.fal.media", { resolveHost: async () => answers }),
      /not public/, label,
    );
  }
  // Allowlisted hostname resolving only to public addresses validates.
  const pinned = await http.resolveAndPin("v3.fal.media", { resolveHost: async () => ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"] });
  assert.equal(pinned.pinned, "93.184.216.34");
  // Mixed answers fail closed even when one is public.
  await assert.rejects(
    http.resolveAndPin("v3.fal.media", { resolveHost: async () => ["93.184.216.34", "10.0.0.5"] }),
    /not public/,
  );
  await assert.rejects(
    http.resolveAndPin("v3.fal.media", { resolveHost: async () => [] }),
    /no addresses/,
  );
  // Explicit test loopback still works for localhost doubles only.
  const looped = await http.resolveAndPin("127.0.0.1", { testLoopback: true, resolveHost: async () => { throw new Error("must not resolve"); } });
  assert.equal(looped.loopback, true);
  await assert.rejects(
    http.resolveAndPin("internal.test", { testLoopback: true, resolveHost: async () => ["10.0.0.5"] }),
    /not public/,
  );
  // Constructor refuses localhost HTTP without the explicit test flag.
  assert.throws(
    () => http.createHttpImageAdapter({ name: "x", endpoint: "http://127.0.0.1:9999/y", apiKey: "k", model: "m" }),
    /must_be_https/,
  );
  assert.throws(
    () => http.createHttpImageAdapter({ name: "x", endpoint: "http://localhost:9999/y", apiKey: "k", model: "m" }),
    /must_be_https/,
  );
  const allowed = http.createHttpImageAdapter({
    name: "x", endpoint: "http://127.0.0.1:9999/y", apiKey: "k", model: "m", testLoopback: true,
  });
  assert.equal(allowed.name, "x");
  // Redirect to a private destination is refused without following it.
  const seen = [];
  const pinnedRedirect = async ({ url }) => {
    seen.push(url);
    if (url === "https://fal.media/start.png") {
      return { status: 302, headers: { get: (name) => (name === "location" ? "http://169.254.169.254/evil" : null) } };
    }
    throw new Error(`must not connect ${url}`);
  };
  await assert.rejects(
    http.downloadArtifact({
      url: "https://fal.media/start.png", allowedOrigins: ["fal.media"],
      resolveHost: async () => ["93.184.216.34"], pinnedRequest: pinnedRedirect,
    }),
    /not retrievable/,
  );
  assert.deepEqual(seen, ["https://fal.media/start.png"]);
  // Pinned path connects to the validated address while preserving Host/SNI.
  const connected = [];
  const pinnedFetch = async ({ url, address }) => {
    connected.push({ url, address });
    return {
      ok: true, status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    };
  };
  const downloaded = await http.downloadArtifact({
    url: "https://v3.fal.media/files/a/b.png", allowedOrigins: ["fal.media"],
    resolveHost: async () => ["93.184.216.34"], pinnedRequest: pinnedFetch,
  });
  assert.equal(downloaded.bytes.length, 4);
  assert.deepEqual(connected, [{ url: "https://v3.fal.media/files/a/b.png", address: "93.184.216.34" }]);
});
