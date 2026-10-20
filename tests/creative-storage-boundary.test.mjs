// Issue #245 storage-boundary contract: explicit backend selection with
// production fail-closed denial, bounded/streamed reads, conditional immutable
// creates, strict keys, static local containment, credential handling, and
// the compiled dashboard wrapper. Native provider acceptance runs against the
// pinned disposable S3-compatible harness separately.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";

import {
  MAX_OBJECT_READ_BYTES,
  STORAGE_BACKENDS,
  createCreativeStorage,
  readCreativeStorageConfig,
  storageModeForEnv,
} from "../packages/creative-runtime/storage/factory.mjs";
import { assertObjectKeyShape, mimeForObjectKey } from "../packages/creative-runtime/storage/keys.mjs";
import { createS3Storage } from "../packages/creative-runtime/storage/s3.mjs";

const require = createRequire(import.meta.url);
const ORG = "71000000-0000-4000-8000-000000000001";
const ASSET = "74000000-0000-4000-8000-000000000001";
const KEY = `t/${ORG}/image/${ASSET}/v1.png`;
const S3_ENV = {
  CREATIVE_STORAGE_BACKEND: "s3",
  CREATIVE_STORAGE_S3_ENDPOINT: "http://s3.test",
  CREATIVE_STORAGE_S3_REGION: "us-east-1",
  CREATIVE_STORAGE_S3_BUCKET: "test-bucket",
  CREATIVE_STORAGE_S3_ACCESS_KEY_ID: "fake-tg245-access-key",
  CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY: "fake-tg245-secret-key-0123456789abcdef",
  CREATIVE_STORAGE_S3_CONDITIONAL_WRITES: "verified",
};

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function streamOf(chunks, onCancel = null) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      onCancel?.();
    },
  });
}

test("factory requires an explicit backend in every mode", () => {
  assert.deepEqual([...STORAGE_BACKENDS], ["local", "s3"]);
  assert.throws(() => createCreativeStorage({ env: {} }), /storage_backend_required/);
  assert.throws(() => createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "" } }), /storage_backend_invalid/);
  assert.throws(() => createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "Local" } }), /storage_backend_invalid/);
  assert.throws(() => createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "filesystem" } }), /storage_backend_invalid/);
  assert.throws(() => createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "s3", CREATIVE_STORAGE_S3_ENDPOINT: "" } }), /storage_s3_configuration_incomplete/);
  const dir = tempDir("tg245-factory-");
  try {
    assert.equal(typeof createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "local" }, dir }), "object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local backend is denied in production and constructor options cannot downgrade that denial", () => {
  assert.equal(storageModeForEnv({}), "development");
  assert.equal(storageModeForEnv({ NODE_ENV: "production" }), "production");
  assert.equal(storageModeForEnv({ APP_ENV: "production" }), "production");
  const dir = tempDir("tg245-prod-");
  try {
    for (const env of [
      { NODE_ENV: "production", CREATIVE_STORAGE_BACKEND: "local" },
      { APP_ENV: "production", CREATIVE_STORAGE_BACKEND: "local" },
    ]) {
      assert.throws(() => createCreativeStorage({ env }), /storage_local_forbidden_in_production/);
      assert.throws(() => createCreativeStorage({ env, mode: "test" }), /storage_local_forbidden_in_production/);
      assert.throws(() => createCreativeStorage({ env, backend: "local", dir }), /storage_local_forbidden_in_production/);
      assert.throws(() => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_BACKEND: "s3" }, backend: "local", dir }), /storage_local_forbidden_in_production/);
    }
    // Production may select the verified S3 backend; the declaration remains mandatory.
    const storage = createCreativeStorage({
      env: { NODE_ENV: "production", ...S3_ENV },
      fetchImpl: async () => new Response(null, { status: 412 }),
    });
    assert.equal(storage.kind, "s3-compatible");
    assert.throws(
      () => createCreativeStorage({ env: { NODE_ENV: "production", ...S3_ENV, CREATIVE_STORAGE_S3_CONDITIONAL_WRITES: "" } }),
      /s3_conditional_writes_unverified/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("s3 configuration is validated before any network use", () => {
  const base = { ...S3_ENV };
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_ENDPOINT: "ftp://s3.test" } }), /storage_s3_endpoint_invalid/);
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_ENDPOINT: "http://user:pass@s3.test" } }), /storage_s3_endpoint_invalid/);
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_ENDPOINT: "http://s3.test/?x=1" } }), /storage_s3_endpoint_invalid/);
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_ENDPOINT: "not a url" } }), /storage_s3_endpoint_invalid/);
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_REGION: "US-East" } }), /storage_s3_configuration_invalid/);
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_BUCKET: "Bad_Bucket" } }), /storage_s3_configuration_invalid/);
  // Loopback endpoints are harness-only: refused under a production signal.
  for (const endpoint of ["http://127.0.0.1:19000", "http://127.0.0.2:19000", "http://localhost.:19000", "http://[::1]:19000", "http://[::ffff:127.0.0.1]:19000"]) {
    assert.throws(
      () => createCreativeStorage({ env: { NODE_ENV: "production", ...base, CREATIVE_STORAGE_S3_ENDPOINT: endpoint } }),
      /storage_s3_endpoint_invalid/,
      endpoint,
    );
  }
  // Direct credential values mirror the #242 printable-ASCII bound.
  assert.throws(
    () => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_ACCESS_KEY_ID: "bad\nkey" } }),
    /credentials_configuration_invalid/,
  );
  // Default fails writes until the operator declares verified conditional semantics.
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_CONDITIONAL_WRITES: undefined } }), /s3_conditional_writes_unverified/);
  assert.throws(() => createCreativeStorage({ env: { ...base, CREATIVE_STORAGE_S3_CONDITIONAL_WRITES: "true" } }), /s3_conditional_writes_unverified/);
  assert.throws(
    () => createCreativeStorage({
      env: { ...base, CREATIVE_STORAGE_S3_ACCESS_KEY_ID: undefined, CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY: undefined },
      fetchImpl: () => null,
    }),
    /credentials_missing/,
  );
});

test("credentials follow the #242 direct-or-file convention with bounded reads and no leakage", () => {
  const dir = tempDir("tg245-secrets-");
  try {
    const keyFile = join(dir, "access-key");
    writeFileSync(keyFile, "fake-file-access-key-1234567890\n");
    const secretFile = join(dir, "secret-key");
    writeFileSync(secretFile, "fake-file-secret-key-0123456789abcdef\r\n");
    const env = {
      ...S3_ENV,
      CREATIVE_STORAGE_S3_ACCESS_KEY_ID: undefined,
      CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY: undefined,
      CREATIVE_STORAGE_S3_ACCESS_KEY_ID_FILE: keyFile,
      CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY_FILE: secretFile,
    };
    const storage = createCreativeStorage({ env, fetchImpl: async () => new Response(null, { status: 200, headers: { etag: '"e"' } }) });
    assert.equal(storage.kind, "s3-compatible");
    const summary = readCreativeStorageConfig(env);
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes("fake-file-access-key"), false);
    assert.equal(serialized.includes("fake-file-secret-key"), false);
    assert.equal(summary.conditionalWrites, true);
    // Ambiguity: both direct and file values are refused, including an empty
    // direct value (#242 parity).
    assert.throws(() => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_S3_ACCESS_KEY_ID: "direct" } }), /credentials_configuration_invalid/);
    assert.throws(() => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_S3_ACCESS_KEY_ID: "" } }), /credentials_configuration_invalid/);
    // Relative, missing, oversized, and non-printable files are refused generically.
    assert.throws(
      () => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_S3_ACCESS_KEY_ID_FILE: "relative/key" } }),
      /credentials_configuration_invalid/,
    );
    assert.throws(
      () => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_S3_ACCESS_KEY_ID_FILE: join(dir, "absent") } }),
      /credentials_configuration_invalid/,
    );
    const big = join(dir, "big");
    writeFileSync(big, "a".repeat(4097));
    assert.throws(() => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_S3_ACCESS_KEY_ID_FILE: big } }), /credentials_configuration_invalid/);
    const binary = join(dir, "binary");
    writeFileSync(binary, Buffer.from([0x66, 0x00, 0x6b]));
    assert.throws(() => createCreativeStorage({ env: { ...env, CREATIVE_STORAGE_S3_ACCESS_KEY_ID_FILE: binary } }), /credentials_configuration_invalid/);
    // Short secrets are refused by the adapter itself.
    assert.throws(
      () => createCreativeStorage({ env: { ...S3_ENV, CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY: "short-secret" }, fetchImpl: () => null }),
      /s3_secret_too_short/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict keys are rejected before any I/O and accept canonical keys only", async () => {
  const invalid = [
    `t/7100000A-0000-4000-8000-000000000001/image/${ASSET}/v1.png`,
    `t/${ORG}/bogus/${ASSET}/v1.png`,
    `t/${ORG}/image/not-a-uuid/v1.png`,
    `t/${ORG}/image/${ASSET}/v0x.png`,
    `t/${ORG}/image/${ASSET}/v1.exe`,
    `t/${ORG}/image/${ASSET}/v1.png.bak`,
    `t/${ORG}/image/${ASSET}/v1.png/extra`,
    `t//image/${ASSET}/v1.png`,
    `/${ORG}/image/${ASSET}/v1.png`,
    `t/${ORG}/%2e%2e/image/${ASSET}/v1.png`,
    `t/${ORG}/image/${ASSET}/../v1.png`,
    `t/${ORG}/image/${ASSET}/v9999999999.png`,
  ];
  for (const key of invalid) {
    assert.throws(() => assertObjectKeyShape(key), /object_key_(shape_violation|traversal)/, key);
  }
  assert.equal(assertObjectKeyShape(KEY), true);
  assert.equal(mimeForObjectKey(KEY), "image/png");
  // Rejected before I/O: a nonexistent local root stays nonexistent.
  const dir = join(tmpdir(), `tg245-noio-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const storage = createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "local" }, dir });
  await assert.rejects(() => storage.get(`t/${ORG}/image/${ASSET}/v1.exe`), /object_key_shape_violation/);
  assert.equal(existsSync(dir), false);
  // S3 rejects before fetch: the counter stays at zero for malformed keys.
  let fetches = 0;
  const wired = createS3Storage({
    endpoint: "http://s3.test", region: "us-east-1", bucket: "test-bucket",
    accessKeyId: "fake-tg245-access-key", secretAccessKey: "fake-tg245-secret-key-0123456789abcdef",
    conditionalWrites: true, fetchImpl: async () => { fetches += 1; return new Response(null, { status: 500 }); },
  });
  await assert.rejects(() => wired.put("t/evil/../../x.png", Buffer.from([1]), "image/png"), /object_key_/);
  await assert.rejects(() => wired.get(`t/${ORG}/image/${ASSET}/v1.exe`), /object_key_shape_violation/);
  assert.equal(fetches, 0);
});

test("local containment round-trips with exclusive create, static link rejection, and bounded reads", async (t) => {
  const root = tempDir("tg245-contained-");
  try {
    const storage = createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "local" }, dir: root });
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const written = await storage.put(KEY, bytes, "image/png");
    assert.equal(written.bytes, 5);
    assert.deepEqual((await storage.get(KEY)).bytes, bytes);
    await assert.rejects(storage.put(KEY, bytes, "image/png"), /object_key_exists/);
    assert.equal(await storage.get(`t/${ORG}/image/${ASSET}/v9.png`), null);
    await assert.rejects(storage.get(KEY, 4), /object_size_exceeded/);
    await assert.rejects(storage.get(KEY, 0), /object_read_bound_invalid/);
    assert.equal((await storage.remove(KEY)).deleted, true);
    assert.equal(await storage.get(KEY), null);

    // Windows junctions (and POSIX symlinks) inside the root are never followed.
    const escapeTarget = tempDir("tg245-escape-");
    const linkRoot = tempDir("tg245-link-");
    try {
      await storage.put(KEY, bytes, "image/png");
      writeFileSync(join(escapeTarget, "outside.png"), bytes);
      const junction = join(linkRoot, "t");
      const { symlinkSync } = require("node:fs");
      symlinkSync(escapeTarget, junction, "junction");
      const linked = createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "local" }, dir: linkRoot });
      await assert.rejects(linked.put(KEY, bytes, "image/png"), /storage_link_unsafe/);
      await assert.rejects(linked.get(KEY), /storage_link_unsafe/);
      await assert.rejects(linked.remove(KEY), /storage_link_unsafe/);
    } finally {
      rmSync(escapeTarget, { recursive: true, force: true });
      rmSync(linkRoot, { recursive: true, force: true });
    }

    // Hard-linked leaves are detected as link anomalies on filesystems that allow them.
    const hardRoot = tempDir("tg245-hard-");
    try {
      const hardStorage = createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "local" }, dir: hardRoot });
      await hardStorage.put(KEY, bytes, "image/png");
      try {
        linkSync(join(hardRoot, ...KEY.split("/")), join(hardRoot, "alias.png"));
      } catch {
        t.diagnostic("hard links unavailable on this filesystem; anomaly check skipped");
      }
      if (existsSync(join(hardRoot, "alias.png"))) {
        await assert.rejects(hardStorage.get(KEY), /storage_link_unsafe/);
      }
    } finally {
      rmSync(hardRoot, { recursive: true, force: true });
    }

    // A root that is replaced after construction is detected by dev/inode pinning.
    const swapRoot = join(tmpdir(), `tg245-swap-${Date.now()}`);
    const swapStorage = createCreativeStorage({ env: { CREATIVE_STORAGE_BACKEND: "local" }, dir: swapRoot });
    await swapStorage.put(KEY, bytes, "image/png");
    rmSync(swapRoot, { recursive: true, force: true });
    writeFileSync(swapRoot, "not a directory");
    await assert.rejects(swapStorage.get(KEY), /storage_root_(changed|invalid)/);
    rmSync(swapRoot, { force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote reads are streamed, bounded, deadline-covered, and sanitized", async () => {
  const credentials = {
    endpoint: "http://s3.test", region: "us-east-1", bucket: "test-bucket",
    accessKeyId: "fake-tg245-access-key", secretAccessKey: "fake-tg245-secret-key-0123456789abcdef",
    conditionalWrites: true,
  };
  const make = (fetchImpl, deadlineMs = 5000) => createS3Storage({ ...credentials, fetchImpl, deadlineMs });

  let cancelled = 0;
  const oversize = make(async () => new Response(streamOf([new Uint8Array(60), new Uint8Array(60)], () => { cancelled += 1; }), { status: 200 }));
  await assert.rejects(oversize.get(KEY, 100), /object_size_exceeded/);
  assert.equal(cancelled, 1);

  let declaredCancel = 0;
  const lyingLength = make(async () => new Response(streamOf([new Uint8Array(1000)], () => { declaredCancel += 1; }), {
    status: 200, headers: { "content-length": "10" },
  }));
  await assert.rejects(lyingLength.get(KEY, 500), /object_size_exceeded/);
  assert.equal(declaredCancel, 1);

  let headerCancel = 0;
  const oversizedHeader = make(async () => new Response(streamOf([new Uint8Array(1)], () => { headerCancel += 1; }), {
    status: 200, headers: { "content-length": "999999999" },
  }));
  await assert.rejects(oversizedHeader.get(KEY, 100), /object_size_exceeded/);
  assert.equal(headerCancel, 1);

  const malformedLength = make(async () => new Response(streamOf([new Uint8Array(1)]), { status: 200, headers: { "content-length": "abc" } }));
  await assert.rejects(malformedLength.get(KEY), /s3_get_failed:malformed_content_length/);

  const within = make(async () => new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), { status: 200 }));
  const read = await within.get(KEY, 10);
  assert.deepEqual(Buffer.from(read.bytes), Buffer.from([1, 2, 3]));
  assert.equal(read.mime, "image/png");

  const missing = make(async () => new Response(null, { status: 404 }));
  assert.equal(await missing.get(KEY), null);

  const denied = make(async () => new Response(null, { status: 403 }));
  await assert.rejects(denied.get(KEY), /s3_get_failed:403/);
  await assert.rejects(denied.put(KEY, Buffer.from([1]), "image/png"), /s3_put_failed:403/);
  const serverError = make(async () => new Response(null, { status: 500 }));
  await assert.rejects(serverError.get(KEY), /s3_get_failed:500/);

  const network = make(async () => { throw new Error("socket exploded at http://user:pass@s3.test/?token=secret"); });
  await assert.rejects(network.get(KEY), (error) => {
    assert.equal(error.message, "s3_network_error");
    assert.equal(/secret|token|pass/.test(error.message), false);
    return true;
  });

  // Deadlines cover the body: a stalled stream is aborted and never partially accepted.
  const stalled = make((url, init) => {
    const stream = new ReadableStream({
      start(controller) {
        init.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  }, 50);
  await assert.rejects(stalled.get(KEY, 10), /s3_deadline_exceeded/);
  // Deadlines also cover the request phase.
  const stalledConnect = make((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), 50);
  await assert.rejects(stalledConnect.get(KEY, 10), /s3_deadline_exceeded/);

  // Duplicate create under concurrency: exactly one winner, 412 refused.
  let calls = 0;
  const concurrent = make(async (url, init) => {
    if (init.method !== "PUT") return new Response(null, { status: 204 });
    calls += 1;
    return new Response(null, { status: calls === 1 ? 200 : 412 });
  });
  const results = await Promise.allSettled([
    concurrent.put(KEY, Buffer.from([1]), "image/png"),
    concurrent.put(KEY, Buffer.from([2]), "image/png"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejection = results.find((r) => r.status === "rejected");
  assert.equal(rejection.status === "rejected" && /object_key_exists/.test(rejection.reason.message), true);
});

test("compiled dashboard storage wrapper delegates and enforces the same boundary", async () => {
  const ts = require("typescript");
  const output = ts.transpileModule(
    readFileSync(new URL("../apps/dashboard/lib/server/creative/storage.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
  ).outputText;
  const lowered = output.toLowerCase();
  for (const hint of ["fetch(", "http://", "https://", "aws_", "s3_", "secret", "password", "token"]) {
    assert.equal(lowered.includes(hint), false, `compiled wrapper must not contain ${hint}`);
  }
  const exports = {};
  runInNewContext(output, {
    exports,
    require: (name) => (name === "server-only" ? {} : require(name)),
    Buffer,
    process: { env: {}, cwd: () => process.cwd() },
  });
  assert.equal(typeof exports.creativeStorage, "function");
  assert.equal(exports.MAX_OBJECT_READ_BYTES, MAX_OBJECT_READ_BYTES);
  let fetches = 0;
  const fetchImpl = async (url, init) => {
    fetches += 1;
    if (init.method === "PUT") return new Response(null, { status: 200, headers: { etag: '"e"' } });
    return new Response(new Uint8Array([9]), { status: 200 });
  };
  const storage = exports.creativeStorage({ env: S3_ENV, fetchImpl });
  await storage.put(KEY, Buffer.from([9]), "image/png");
  assert.equal(fetches, 1);
  assert.deepEqual(Buffer.from((await storage.get(KEY, 100)).bytes), Buffer.from([9]));
  assert.throws(
    () => exports.creativeStorage({ env: { NODE_ENV: "production", CREATIVE_STORAGE_BACKEND: "local" } }),
    /storage_local_forbidden_in_production/,
  );
  // The compiled wrapper binds no ambient backend: unset env fails closed.
  assert.throws(() => exports.creativeStorage({ env: {} }), /storage_backend_required/);
});

test("worker CLIs refuse to run without an explicit storage backend", async () => {
  const { spawnSync } = require("node:child_process");
  const cases = [
    ["scripts/creative-design-worker.mjs", [], /CREATIVE_STORAGE_BACKEND is required/],
    ["scripts/creative-motion-worker.mjs", [], /CREATIVE_STORAGE_BACKEND is required/],
    ["scripts/creative-segment-worker.mjs", [], /CREATIVE_STORAGE_BACKEND is required/],
    ["scripts/creative-video-worker.mjs", [], /CREATIVE_STORAGE_BACKEND is required/],
    ["scripts/creative-presenter-worker.mjs", ["--operation=talking_head"], /private_runtime_configuration_required/],
  ];
  for (const [script, args, pattern] of cases) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
        DATABASE_URL: "fixture-only", CREATIVE_PROVIDER_EXECUTION_AUTHORIZED: "true", TALKING_HEAD_ENABLED: "true",
      },
      timeout: 20000,
      cwd: process.cwd(),
    });
    assert.notEqual(result.status, 0, script);
    assert.match(`${result.stderr}\n${result.stdout}`, pattern, script);
  }
});
