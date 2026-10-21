import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const endpoint = (process.env.DEMO_S3_ENDPOINT ?? "").replace(/\/$/, "");
const region = process.env.DEMO_S3_REGION ?? "us-east-1";
const bucket = process.env.DEMO_S3_BUCKET ?? "";
if (!endpoint || !bucket) throw new Error("demo S3 endpoint and bucket are required");

function secret(path) {
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error(`empty demo S3 secret: ${path}`);
  return value;
}

const accessKeyId = secret("/run/secrets/s3_access_key");
const secretAccessKey = secret("/run/secrets/s3_secret_key");

function hashHex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return { stamp, dateStamp: stamp.slice(0, 8) };
}

async function signed(method, path) {
  const url = new URL(endpoint + path);
  const { stamp, dateStamp } = amzDate();
  const payloadHash = hashHex("");
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join("");
  const canonical = [method, url.pathname, "", canonicalHeaders, names.join(";"), payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, hashHex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), "s3"), "aws4_request");
  const signature = hmac(key, stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateStamp}/${region}/s3/aws4_request, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...headers, Authorization: authorization },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { status: 0 };
  }
  await response.arrayBuffer().catch(() => undefined);
  return { status: response.status };
}

const bucketPath = `/${bucket}`;
let created = false;
for (let attempt = 0; attempt < 60 && !created; attempt += 1) {
  const result = await signed("PUT", bucketPath);
  if (result.status === 200 || result.status === 409) {
    const head = await signed("HEAD", bucketPath);
    if (head.status === 200) {
      created = true;
      break;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (!created) throw new Error("demo S3 bucket initialization failed");
console.log("DEMO_S3_BUCKET_READY");
