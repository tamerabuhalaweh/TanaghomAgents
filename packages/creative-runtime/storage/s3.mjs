// Minimal S3-compatible object adapter: SigV4 header auth for PUT/GET/
// DELETE/HEAD plus SigV4 presigned GET URLs. Zero new dependencies
// (undici fetch + node:crypto only). Never used with production
// credentials in P2a; exercised against a disposable S3-compatible
// harness and AWS signing self-checks in tests.
//
// Immutability: clears are conditional (`If-None-Match: *`) and only
// enabled when the operator has declared the provider capability is
// verified (see storage/factory.mjs). There is no fallback that writes
// unconditionally, and 409/501 responses fail closed. Reads are strictly
// bounded: the limit is validated before any I/O, declared
// Content-Length is checked, streamed bytes are counted, and oversized or
// over-deadline bodies are aborted and never partially accepted. Provider
// and network errors are sanitized to stable codes.
import { createHash, createHmac } from "node:crypto";

import { assertObjectKeyShape, mimeForObjectKey, validateReadLimit } from "./keys.mjs";

function hashHex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return { amzDate: stamp, dateStamp: stamp.slice(0, 8) };
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function cancelQuietly(stream) {
  try {
    await stream?.cancel?.();
  } catch {
    // cancellation is best effort; the error path stands on its own
  }
}

export function canonicalRequest({ method, path, query = "", headers, payloadHash }) {
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, " ")}\n`).join("");
  return [method.toUpperCase(), path, query, canonicalHeaders, names.join(";"), payloadHash].join("\n");
}

export function stringToSign({ amzDate: stamp, dateStamp, region, service, canonicalRequestHash }) {
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  return [`AWS4-HMAC-SHA256`, stamp, scope, canonicalRequestHash].join("\n");
}

export function signingKey({ secretAccessKey, dateStamp, region, service }) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export function signatureV4({ secretAccessKey, dateStamp, region, service, stringToSign: sts }) {
  return hmac(signingKey({ secretAccessKey, dateStamp, region, service }), sts).toString("hex");
}

const DEFAULT_DEADLINE_MS = 120000;

export function createS3Storage({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  fetchImpl = fetch,
  conditionalWrites = false,
  deadlineMs = DEFAULT_DEADLINE_MS,
}) {
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("s3_configuration_incomplete");
  }
  if (secretAccessKey.length < 16) throw new Error("s3_secret_too_short");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 600000) {
    throw new Error("s3_deadline_invalid");
  }
  const base = endpoint.replace(/\/$/, "");
  const service = "s3";

  function objectUrl(key) {
    assertObjectKeyShape(key);
    return `${base}/${bucket}/${key.split("/").map(encodePathSegment).join("/")}`;
  }

  async function signedFetch({ method, key, body = null, contentType = null, extraHeaders = null, signal = undefined }) {
    const url = new URL(objectUrl(key));
    const { amzDate: stamp, dateStamp } = amzDate();
    const payloadHash = body ? hashHex(body) : hashHex("");
    const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
    if (contentType) headers["content-type"] = contentType;
    if (extraHeaders) {
      for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;
    }
    const canonical = canonicalRequest({ method, path: url.pathname, query: "", headers, payloadHash });
    const sts = stringToSign({ amzDate: stamp, dateStamp, region, service, canonicalRequestHash: hashHex(canonical) });
    const signature = signatureV4({ secretAccessKey, dateStamp, region, service, stringToSign: sts });
    const signedHeaders = Object.keys(headers).map((name) => name.toLowerCase()).sort().join(";");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    try {
      return await fetchImpl(url.toString(), {
        method,
        headers: { ...headers, Authorization: authorization },
        ...(body ? { body, duplex: "half" } : {}),
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new Error(signal?.aborted ? "s3_deadline_exceeded" : "s3_network_error");
    }
  }

  function withDeadline(operation) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    return operation(controller.signal).finally(() => clearTimeout(timer));
  }

  return Object.freeze({
    kind: "s3-compatible",
    bucket,
    region,
    async put(key, bytes, mime) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("bytes_required");
      if (!conditionalWrites) throw new Error("s3_conditional_writes_unverified");
      if (mimeForObjectKey(key) !== mime) throw new Error("mime_extension_mismatch");
      return withDeadline(async (signal) => {
        const response = await signedFetch({
          method: "PUT",
          key,
          body: bytes,
          contentType: mime,
          extraHeaders: { "if-none-match": "*" },
          signal,
        });
        if (response.status === 412) throw new Error("object_key_exists");
        if (response.status === 409) throw new Error("s3_conditional_conflict");
        if (response.status === 501) throw new Error("s3_conditional_writes_unverified");
        if (![200, 201].includes(response.status)) throw new Error(`s3_put_failed:${response.status}`);
        const etag = response.headers?.get?.("etag") ?? null;
        return { key, sha256: hashHex(bytes), bytes: bytes.length, etag };
      });
    },
    async get(key, maxBytes) {
      const limit = validateReadLimit(maxBytes);
      return withDeadline(async (signal) => {
        const response = await signedFetch({ method: "GET", key, signal });
        if (response.status === 404) {
          await cancelQuietly(response.body);
          return null;
        }
        if (response.status !== 200) {
          await cancelQuietly(response.body);
          throw new Error(`s3_get_failed:${response.status}`);
        }
        const lengthHeader = response.headers?.get?.("content-length");
        if (lengthHeader !== undefined && lengthHeader !== null) {
          const raw = String(lengthHeader).trim();
          if (!/^\d{1,15}$/.test(raw)) {
            await cancelQuietly(response.body);
            throw new Error("s3_get_failed:malformed_content_length");
          }
          if (Number(raw) > limit) {
            await cancelQuietly(response.body);
            throw new Error("object_size_exceeded");
          }
        }
        const reader = response.body?.getReader?.();
        if (!reader) {
          await cancelQuietly(response.body);
          throw new Error("s3_get_failed:no_body");
        }
        const chunks = [];
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(value instanceof Uint8Array)) throw new Error("s3_get_failed:malformed_body");
            total += value.byteLength;
            if (total > limit) throw new Error("object_size_exceeded");
            chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          if (signal.aborted) throw new Error("s3_deadline_exceeded");
          if (typeof error?.message === "string" && /^(object_size_exceeded|s3_)/.test(error.message)) throw error;
          throw new Error("s3_network_error");
        }
        return { bytes: Buffer.concat(chunks, total), mime: mimeForObjectKey(key) };
      });
    },
    async remove(key) {
      return withDeadline(async (signal) => {
        const response = await signedFetch({ method: "DELETE", key, signal });
        if (![200, 204].includes(response.status)) throw new Error(`s3_delete_failed:${response.status}`);
        return { key, deleted: true };
      });
    },
    // Short-lived presigned GET (SigV4 query auth). The URL is a bearer
    // preview hint, never the canonical asset identity.
    presignGet(key, ttlSeconds = 900, now = new Date()) {
      assertObjectKeyShape(key);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error("invalid_preview_ttl");
      const { amzDate: stamp, dateStamp } = amzDate(now);
      const credential = `${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request`;
      const signedHeaders = "host";
      const params = new URLSearchParams({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": credential,
        "X-Amz-Date": stamp,
        "X-Amz-Expires": String(ttlSeconds),
        "X-Amz-SignedHeaders": signedHeaders,
      });
      const url = new URL(objectUrl(key));
      const canonical = canonicalRequest({
        method: "GET", path: url.pathname, query: params.toString().replace(/\+/g, "%20"),
        headers: { host: url.host }, payloadHash: "UNSIGNED-PAYLOAD",
      });
      const sts = stringToSign({ amzDate: stamp, dateStamp, region, service, canonicalRequestHash: hashHex(canonical) });
      params.set("X-Amz-Signature", signatureV4({ secretAccessKey, dateStamp, region, service, stringToSign: sts }));
      return { url: `${url.origin}${url.pathname}?${params.toString()}`, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), previewOnly: true };
    },
  });
}
