// Object-key construction, parsing, checksums, and preview-token helpers.
// Keys are tenant-scoped and immutable: t/<org>/<capability>/<asset>/<v>.<ext>
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CAPABILITIES, MIME_TYPES } from '../capabilities.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXT_BY_MIME = Object.freeze({
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg':'ogg', 'audio/flac':'flac', 'audio/aac':'aac', 'text/html': 'html',
});
const MIME_BY_EXT = Object.freeze(Object.fromEntries([
  ...Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
  // Legacy read compatibility: `.jpeg` maps like `.jpg`, but builders only
  // ever emit `jpg`.
  ['jpeg', 'image/jpeg'],
]));
const KEY_RE = /^t\/([0-9a-f-]{36})\/([a-z_]+)\/([0-9a-f-]{36})\/v(\d+)\.(png|jpg|jpeg|webp|mp4|wav|mp3|ogg|flac|aac|html)$/i;

export function extensionForMime(mime) {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`unsupported_mime:${mime}`);
  return ext;
}

export function buildObjectKey({ organizationId, capability, assetId, version, mime }) {
  if (!UUID_RE.test(organizationId ?? '')) throw new Error('invalid_organization_id');
  if (!UUID_RE.test(assetId ?? '')) throw new Error('invalid_asset_id');
  if (!Number.isInteger(version) || version < 1) throw new Error('invalid_version');
  const ext = extensionForMime(mime);
  return `t/${organizationId}/${capability}/${assetId}/v${version}.${ext}`;
}

export function parseObjectKey(key) {
  const match = KEY_RE.exec(key ?? '');
  if (!match) throw new Error('invalid_object_key');
  const [, organizationId, capability, assetId, version, ext] = match;
  return { organizationId, capability, assetId, version: Number(version), mime: MIME_BY_EXT[ext.toLowerCase()] };
}

// Conservative ceiling for any single object read. Matches the largest
// governed provider artifact (0046 talking-head video gate, 100 MiB); the
// migration caps object bytes at 500 MB, so nothing legitimately read by the
// runtime exceeds this. Backends bound every read to maxBytes or this
// ceiling, whichever is smaller.
export const MAX_OBJECT_READ_BYTES = 100 * 1024 * 1024;

export function validateReadLimit(maxBytes) {
  const limit = maxBytes === undefined || maxBytes === null ? MAX_OBJECT_READ_BYTES : maxBytes;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OBJECT_READ_BYTES) {
    throw new Error('object_read_bound_invalid');
  }
  return limit;
}

// Strict shape gate shared by every backend, applied before any I/O:
// canonical t/<uuid>/<capability>/<uuid>/v<N>.<ext> only. Rejects traversal,
// percent-encoded segments, empty/double separators, unsupported
// capabilities/extensions, and bucket escapes. The database predicate keeps
// its own (looser) legacy pattern; this gate is intentionally exact.
const STRICT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STRICT_KEY_SEGMENT_4_RE = /^v[0-9]{1,9}\.(png|jpg|jpeg|webp|mp4|wav|mp3|ogg|flac|aac|html)$/;

export function assertObjectKeyShape(key) {
  if (typeof key !== 'string' || key.length < 3 || key.length > 512) throw new Error('object_key_shape_violation');
  if (key.includes('..')) throw new Error('object_key_traversal');
  const segments = key.split('/');
  if (segments.length !== 5 || segments[0] !== 't') throw new Error('object_key_shape_violation');
  if (!STRICT_UUID_RE.test(segments[1]) || !STRICT_UUID_RE.test(segments[3])) throw new Error('object_key_shape_violation');
  if (!CAPABILITIES.includes(segments[2])) throw new Error('object_key_shape_violation');
  if (!STRICT_KEY_SEGMENT_4_RE.test(segments[4])) throw new Error('object_key_shape_violation');
  return true;
}

export function mimeForObjectKey(key) {
  assertObjectKeyShape(key);
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error('unsupported_object_extension');
  return mime;
}

export function sha256Hex(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('bytes_required');
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyChecksum(bytes, expectedHex) {
  if (typeof expectedHex !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const actual = Buffer.from(sha256Hex(bytes), 'hex');
  const expected = Buffer.from(expectedHex.toLowerCase(), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Preview tokens are HMAC-bound bearer hints for the gateway, never the
// canonical asset identity and never a public URL.
export function previewToken({ secret, objectKey, expiresAt }) {
  if (!secret || secret.length < 32) throw new Error('preview_secret_too_short');
  if (!objectKey) throw new Error('object_key_required');
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (!Number.isFinite(exp)) throw new Error('invalid_expiry');
  const sig = createHmac('sha256', secret).update(`${objectKey}:${exp}`).digest('hex');
  return { token: `${exp}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyPreviewToken({ secret, objectKey, token, now = new Date() }) {
  if (!secret || !objectKey || !token) return false;
  const [expRaw, sig] = String(token).split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sig || sig.length !== 64) return false;
  if (Math.floor(now.getTime() / 1000) > exp) return false;
  const expected = createHmac('sha256', secret).update(`${objectKey}:${exp}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig.toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export { MIME_TYPES };
