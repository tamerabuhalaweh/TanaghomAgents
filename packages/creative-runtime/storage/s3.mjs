// Minimal S3-compatible object adapter: SigV4 header auth for PUT/GET/
// DELETE/HEAD plus SigV4 presigned GET URLs. Zero new dependencies
// (undici fetch + node:crypto only). Never used with production
// credentials in P2a; exercised against a disposable S3-compatible
// harness and AWS signing self-checks in tests.
import { createHash, createHmac } from "node:crypto";

const KEY_RE = /^t\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\/v[0-9]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|html)$/;
const MIME_BY_EXT = Object.freeze({
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  mp4: "video/mp4", wav: "audio/wav", mp3: "audio/mpeg", html: "text/html",
});

function assertKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new Error("object_key_shape_violation");
}

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

export function createS3Storage({ endpoint, region, bucket, accessKeyId, secretAccessKey, fetchImpl = fetch }) {
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("s3_configuration_incomplete");
  }
  if (secretAccessKey.length < 16) throw new Error("s3_secret_too_short");
  const base = endpoint.replace(/\/$/, "");
  const service = "s3";

  function objectUrl(key) {
    assertKey(key);
    return `${base}/${bucket}/${key.split("/").map(encodePathSegment).join("/")}`;
  }

  async function signedFetch({ method, key, body = null, contentType = null, extraQuery = "" }) {
    const url = new URL(objectUrl(key));
    if (extraQuery) url.search = extraQuery;
    const { amzDate: stamp, dateStamp } = amzDate();
    const payloadHash = body ? hashHex(body) : hashHex("");
    const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
    if (contentType) headers["content-type"] = contentType;
    const canonical = canonicalRequest({ method, path: url.pathname, query: url.search.slice(1), headers, payloadHash });
    const sts = stringToSign({ amzDate: stamp, dateStamp, region, service, canonicalRequestHash: hashHex(canonical) });
    const signature = signatureV4({ secretAccessKey, dateStamp, region, service, stringToSign: sts });
    const signedHeaders = Object.keys(headers).map((name) => name.toLowerCase()).sort().join(";");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetchImpl(url.toString(), {
      method, headers: { ...headers, Authorization: authorization }, ...(body ? { body, duplex: "half" } : {}),
    });
    return response;
  }

  function contentTypeFor(key) {
    const ext = key.split(".").pop().toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) throw new Error("unsupported_object_extension");
    return mime;
  }

  return Object.freeze({
    kind: "s3-compatible",
    bucket,
    region,
    async put(key, bytes, mime) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("bytes_required");
      if (contentTypeFor(key) !== mime) throw new Error("mime_extension_mismatch");
      const response = await signedFetch({ method: "PUT", key, body: bytes, contentType: mime });
      if (![200, 201].includes(response.status)) throw new Error(`s3_put_failed:${response.status}`);
      const etag = response.headers?.get?.("etag") ?? null;
      return { key, sha256: hashHex(bytes), bytes: bytes.length, etag };
    },
    async get(key) {
      const response = await signedFetch({ method: "GET", key });
      if (response.status === 404) return null;
      if (response.status !== 200) throw new Error(`s3_get_failed:${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, mime: contentTypeFor(key) };
    },
    async remove(key) {
      const response = await signedFetch({ method: "DELETE", key });
      if (![200, 204].includes(response.status)) throw new Error(`s3_delete_failed:${response.status}`);
      return { key, deleted: true };
    },
    // Short-lived presigned GET (SigV4 query auth). The URL is a bearer
    // preview hint, never the canonical asset identity.
    presignGet(key, ttlSeconds = 900, now = new Date()) {
      assertKey(key);
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
