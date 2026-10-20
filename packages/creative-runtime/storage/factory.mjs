// Central creative-storage factory. Every server-side consumer (dashboard
// routes, worker CLIs, harnesses) must select a backend through here; there
// is no second storage identity and no ambient default. Semantics:
//
// - `CREATIVE_STORAGE_BACKEND` must be explicitly `local` or `s3`; a
//   missing, empty, or unknown value fails closed (`storage_backend_required`
//   / `storage_backend_invalid`).
// - `local` is development/test/harness only. Any production signal
//   (NODE_ENV=production or APP_ENV=production) denies it, and constructor
//   options can never downgrade that denial.
// - `s3` requires complete explicit private-bucket configuration and an
//   operator declaration that conditional-write semantics are verified
//   (`CREATIVE_STORAGE_S3_CONDITIONAL_WRITES=verified`). Without that
//   declaration the factory refuses to construct a writable backend, so
//   writes fail closed.
// - Credentials follow the #242 server-only convention: either a direct
//   value or an absolute `_FILE` path, never both (refused as ambiguous);
//   file reads are bounded and errors are generic. Construction performs
//   no network I/O (credential files may be read locally) and never
//   includes secrets in returned summaries.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";

import { MAX_OBJECT_READ_BYTES } from "./keys.mjs";
import { createLocalFsStorage } from "./local-fs.mjs";
import { createS3Storage } from "./s3.mjs";

export const STORAGE_BACKENDS = Object.freeze(["local", "s3"]);

const MAX_SECRET_FILE_BYTES = 4096;
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]{1,4096}$/;
const REGION_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export function storageModeForEnv(env = {}) {
  return env.NODE_ENV === "production" || env.APP_ENV === "production" ? "production" : "development";
}

// One credential, either direct or via absolute `_FILE` path (never both).
// Mirrors the SmartLabs #242 convention exactly: same ambiguity rule, same
// direct/file value bounds, generic failure codes; values are never echoed.
function readSecret(env, name) {
  const direct = env[name];
  const filePath = env[`${name}_FILE`];
  if (direct !== undefined && filePath !== undefined) {
    throw new Error("credentials_configuration_invalid");
  }
  let value = direct ?? "";
  if (filePath !== undefined) {
    let descriptor;
    try {
      if (typeof filePath !== "string" || !isAbsolute(filePath)) throw new Error("credentials_configuration_invalid");
      descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.size < 1 || info.size > MAX_SECRET_FILE_BYTES) {
        throw new Error("credentials_configuration_invalid");
      }
      const buffer = Buffer.alloc(MAX_SECRET_FILE_BYTES + 1);
      let total = 0;
      let read;
      while ((read = readSync(descriptor, buffer, total, buffer.length - total, null)) > 0) {
        total += read;
        if (total > MAX_SECRET_FILE_BYTES) throw new Error("credentials_configuration_invalid");
      }
      value = buffer.subarray(0, total).toString("utf8").replace(/\r?\n$/, "");
    } catch {
      throw new Error("credentials_configuration_invalid");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  if (
    typeof value !== "string"
    || (value !== "" && !PRINTABLE_ASCII_RE.test(value))
    || (filePath !== undefined && value === "")
  ) {
    throw new Error("credentials_configuration_invalid");
  }
  return value;
}

function requireText(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error("storage_s3_configuration_incomplete");
  return value;
}

function isLoopbackHost(rawHost) {
  const host = rawHost.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  if (host === "localhost") return true;
  const kind = isIP(host);
  if (kind === 4) return host.split(".")[0] === "127";
  if (kind === 6) {
    if (host === "::1") return true;
    // URL normalizes IPv4-mapped/compatible loopback to hex hextets
    // (::ffff:127.0.0.1 -> ::ffff:7f00:1, ::127.0.0.1 -> ::7f00:1).
    const tail = host.startsWith("::ffff:") ? host.slice(7) : host.startsWith("::") ? host.slice(2) : null;
    if (!tail) return false;
    const first = tail.split(":")[0];
    if (tail.includes(".")) return first === "127";
    return /^[0-9a-f]{1,4}$/.test(first) && (parseInt(first, 16) >>> 8) === 0x7f;
  }
  return false;
}

function readEndpoint(env, mode) {
  const raw = requireText(env, "CREATIVE_STORAGE_S3_ENDPOINT");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("storage_s3_endpoint_invalid");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("storage_s3_endpoint_invalid");
  if (url.username || url.password || url.search || url.hash) throw new Error("storage_s3_endpoint_invalid");
  if (isLoopbackHost(url.hostname) && mode === "production") throw new Error("storage_s3_endpoint_invalid");
  return raw.replace(/\/+$/, "");
}

// Validates configuration and returns a secret-free summary (safe to log).
export function readCreativeStorageConfig(env = {}) {
  const mode = storageModeForEnv(env);
  const backend = env.CREATIVE_STORAGE_BACKEND;
  if (backend === undefined) throw new Error("storage_backend_required");
  if (typeof backend !== "string" || !STORAGE_BACKENDS.includes(backend)) throw new Error("storage_backend_invalid");
  if (backend === "local") {
    if (mode === "production") throw new Error("storage_local_forbidden_in_production");
    const dir = env.CREATIVE_UPLOAD_DIR;
    if (typeof dir !== "string" || dir.length === 0) throw new Error("storage_dir_required");
    return Object.freeze({ mode, backend, dir });
  }
  const endpoint = readEndpoint(env, mode);
  const region = requireText(env, "CREATIVE_STORAGE_S3_REGION");
  if (!REGION_RE.test(region)) throw new Error("storage_s3_configuration_invalid");
  const bucket = requireText(env, "CREATIVE_STORAGE_S3_BUCKET");
  if (!BUCKET_RE.test(bucket)) throw new Error("storage_s3_configuration_invalid");
  if (env.CREATIVE_STORAGE_S3_CONDITIONAL_WRITES !== "verified") throw new Error("s3_conditional_writes_unverified");
  return Object.freeze({ mode, backend, endpoint, region, bucket, conditionalWrites: true });
}

export function createCreativeStorage({
  env = process.env,
  mode,
  backend,
  dir,
  fetchImpl,
  deadlineMs,
  readLimitBytes,
} = {}) {
  const envMode = storageModeForEnv(env);
  // Constructor options can never downgrade a production environment.
  const effectiveMode = envMode === "production" ? "production" : mode ?? "development";
  const selected = backend ?? env.CREATIVE_STORAGE_BACKEND;
  if (selected === undefined) throw new Error("storage_backend_required");
  if (typeof selected !== "string" || !STORAGE_BACKENDS.includes(selected)) throw new Error("storage_backend_invalid");
  if (selected === "local") {
    if (effectiveMode === "production") throw new Error("storage_local_forbidden_in_production");
    // Directory default matches the historical dashboard default; the
    // backend itself is never implicit, only the directory is.
    const localDir = dir ?? env.CREATIVE_UPLOAD_DIR ?? join(process.cwd(), "tmp", "creative-uploads");
    if (typeof localDir !== "string" || localDir.length === 0) throw new Error("storage_dir_required");
    return createLocalFsStorage({ dir: localDir, readLimitBytes });
  }
  const config = readCreativeStorageConfig({ ...env, CREATIVE_STORAGE_BACKEND: "s3" });
  const accessKeyId = readSecret(env, "CREATIVE_STORAGE_S3_ACCESS_KEY_ID");
  const secretAccessKey = readSecret(env, "CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) throw new Error("credentials_missing");
  return createS3Storage({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId,
    secretAccessKey,
    fetchImpl,
    conditionalWrites: true,
    deadlineMs,
  });
}

export { MAX_OBJECT_READ_BYTES };
