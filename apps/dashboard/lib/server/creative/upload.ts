import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import sharp, { type Metadata as SharpMetadata } from "sharp";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import {
  CreativeDisabledError,
  requireCreativeStudio,
} from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";
import { buildUploadObjectKey } from "@/lib/server/creative/object-keys";
import { localStorage, sha256Hex } from "@/lib/server/creative/storage";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXT_BY_MIME: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
};

export class UploadRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function magicMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function sanitizeFileName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "upload";
}

export async function uploadSourceImage(request: NextRequest) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    const user = await authorize(request, ["owner", "operator"]);
    const headerKey = idempotencyKey(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new UploadRequestError("invalid_multipart", 400);
    }
    const file = form.get("file");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      throw new UploadRequestError("file_required", 400);
    }
    const upload = file as File;
    const bytes = Buffer.from(await upload.arrayBuffer());
    if (bytes.length === 0) throw new UploadRequestError("empty_file", 400);
    if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadRequestError("file_too_large", 413);
    const detected = magicMime(bytes);
    if (!detected || !ALLOWED_MIME.has(detected)) throw new UploadRequestError("unsupported_mime", 415);
    const declared = (upload.type || "").toLowerCase();
    if (declared && declared !== detected) throw new UploadRequestError("mime_spoof_rejected", 415);
    const originalName = sanitizeFileName(upload.name || "upload");
    const extension = originalName.includes(".") ? originalName.split(".").pop()!.toLowerCase() : "";
    if (!EXT_BY_MIME[detected].includes(extension)) throw new UploadRequestError("extension_mismatch", 415);
    const title = typeof form.get("title") === "string" ? (form.get("title") as string).trim().slice(0, 200) : "";
    // sharp validates parseability (malformed images fail here) with a pixel
    // cap so decompression bombs fail closed before full decode.
    let metadata: SharpMetadata;
    try {
      metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
    } catch {
      throw new UploadRequestError("malformed_image", 415);
    }
    if (!metadata.width || !metadata.height) throw new UploadRequestError("malformed_image", 415);
    if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
      throw new UploadRequestError("image_dimensions_exceeded", 413);
    }
    const sha256 = sha256Hex(bytes);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ sha256, title })).digest("hex")}`;
    const correlationId = randomUUID();
    const objectKey = buildUploadObjectKey({
      organizationId: user.organizationId,
      capability: "image",
      nonce: randomUUID(),
      version: 1,
      mime: detected,
    });
    const storage = localStorage();
    try {
      const stored = await storage.put(objectKey, bytes, detected);
      if (stored.sha256 !== sha256) throw new UploadRequestError("checksum_mismatch", 500);
    } catch (error) {
      if (error instanceof Error && error.message === "object_key_exists") {
        throw new UploadRequestError("duplicate_object_key", 409);
      }
      throw error;
    }
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.upload", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        // Replay must not store a second copy: the first attempt owns the key.
        await storage.remove(objectKey);
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let registered: { o_job_id: string; o_asset_id: string; o_version_id: string };
      try {
        const result = await client.query<{ o_job_id: string; o_asset_id: string; o_version_id: string }>(
          `SELECT * FROM tanaghom.register_upload_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [user.id, "image", title || originalName, detected, metadata.width, metadata.height,
            bytes.length, sha256, objectKey,
            JSON.stringify({
              upload: true, original_name: originalName, declared_mime: declared || null,
              detected_mime: detected, width: metadata.width, height: metadata.height,
              exif_present: !!metadata.exif, exif_stripped: false,
            }),
            randomUUID(), correlationId],
        );
        registered = result.rows[0];
      } catch (error) {
        await storage.remove(objectKey);
        if (error instanceof Error && /creative (enqueue requires|invalid upload|unknown creative|object key|runtime stopped)/.test(error.message)) {
          throw new UploadRequestError("upload_rejected", 400);
        }
        throw error;
      }
      const responseBody = {
        ok: true,
        job_id: registered.o_job_id,
        asset_id: registered.o_asset_id,
        version_id: registered.o_version_id,
        correlation_id: correlationId,
        sha256,
        object_key: objectKey,
      };
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.upload_registered', 'creative_asset_version', $3, $4::jsonb, 'success')`,
        [correlationId, user.id, registered.o_version_id,
          JSON.stringify({ bytes: bytes.length, mime: detected, original_name: originalName })],
      );
      await completeIdempotency(client, (slot as { reservation_id: string }).reservation_id, 200, responseBody);
      await client.query("COMMIT");
      return noStore(responseBody);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof UploadRequestError || error instanceof CreativeJobRequestError || error instanceof IdempotencyRequestError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}
