import "server-only";

// Tenant-scoped immutable object-key builder. Mirrors
// packages/creative-runtime/storage/keys.mjs and the
// tanaghom.creative_object_key_is_scoped() shape check; a parity test
// pins the three implementations to the same allowlist and prefix rule.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "text/html": "html",
};
const KEY_RE = /^t\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\/v[0-9]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|html)$/;

export function extensionForMime(mime: string) {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`unsupported_mime:${mime}`);
  return ext;
}

export function buildUploadObjectKey(args: {
  organizationId: string;
  capability: string;
  nonce: string;
  version: number;
  mime: string;
}) {
  if (!UUID_RE.test(args.organizationId)) throw new Error("invalid_organization_id");
  if (!UUID_RE.test(args.nonce)) throw new Error("invalid_nonce");
  if (!/^[a-z_]+$/.test(args.capability)) throw new Error("invalid_capability");
  if (!Number.isInteger(args.version) || args.version < 1) throw new Error("invalid_version");
  const key = `t/${args.organizationId}/${args.capability}/${args.nonce}/v${args.version}.${extensionForMime(args.mime)}`;
  if (!KEY_RE.test(key)) throw new Error("object_key_shape_violation");
  return key;
}
