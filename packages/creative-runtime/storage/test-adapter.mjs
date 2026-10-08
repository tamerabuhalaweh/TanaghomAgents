// In-memory test storage adapter. Deterministic, no network, no disk, no
// credentials. Used by unit tests and the disposable integration harness.
// Production backends implement the same five operations.
import { sha256Hex, verifyChecksum } from './keys.mjs';

const MAX_TEST_BYTES = 8 * 1024 * 1024;

export function createTestStorage({ secret = 'test-secret-at-least-32-characters!!' } = {}) {
  if (secret.length < 32) throw new Error('preview_secret_too_short');
  const objects = new Map();

  function put({ key, bytes, mime, thumbKey = null }) {
    if (typeof key !== 'string' || key.length < 3) throw new Error('object_key_required');
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('bytes_required');
    if (bytes.length > MAX_TEST_BYTES) throw new Error('object_too_large');
    if (!mime) throw new Error('mime_required');
    if (objects.has(key)) throw new Error('object_key_immutable');
    const checksum = sha256Hex(bytes);
    objects.set(key, { bytes: Buffer.from(bytes), mime, thumbKey, sha256: checksum, storedAt: new Date().toISOString() });
    return { key, sha256: checksum, bytes: bytes.length };
  }

  function get(key) {
    const object = objects.get(key);
    if (!object) throw new Error('object_not_found');
    return { bytes: Buffer.from(object.bytes), mime: object.mime, thumbKey: object.thumbKey, sha256: object.sha256 };
  }

  function has(key) {
    return objects.has(key);
  }

  function remove(key, reason = 'test-cleanup') {
    if (!objects.delete(key)) throw new Error('object_not_found');
    return { key, deleted: true, reason };
  }

  function signPreview(key, ttlSeconds = 900) {
    if (!objects.has(key)) throw new Error('object_not_found');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error('invalid_preview_ttl');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return { key, url: `test-preview://${key}`, expiresAt, previewOnly: true };
  }

  function verifyStored(key, expectedHex) {
    const object = objects.get(key);
    if (!object) return false;
    return verifyChecksum(object.bytes, expectedHex);
  }

  return Object.freeze({ kind: 'test-memory', put, get, has, remove, signPreview, verifyStored });
}
