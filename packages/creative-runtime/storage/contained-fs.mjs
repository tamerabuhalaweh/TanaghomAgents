// Contained local-filesystem object store (dependency-free). This is the
// single local backend implementation: every path is derived from the
// canonical object key, the configured root is pinned by device/inode and
// re-verified on each operation, and every segment is statically checked so
// no symlink/junction is ever followed out of the root. Known limitation:
// Node exposes no mkdirat/openat-style confinement, so containment is
// static, not race-free; production eligibility is DENIED (see
// docs/decisions/creative-storage-boundary.md). Local use is limited to
// development, tests, and disposable harnesses.
import { lstat, mkdir, open, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertObjectKeyShape, mimeForObjectKey, sha256Hex, validateReadLimit } from "./keys.mjs";

const READ_CHUNK_BYTES = 64 * 1024;

async function lstatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function createContainedFs({ dir, readLimitBytes } = {}) {
  if (typeof dir !== "string" || dir.length === 0) throw new Error("storage_dir_required");
  const configuredLimit = readLimitBytes === undefined ? undefined : validateReadLimit(readLimitBytes);
  let rootPromise = null;

  function containmentRoot() {
    if (!rootPromise) {
      rootPromise = (async () => {
        await mkdir(dir, { recursive: true });
        const resolved = await realpath(dir);
        const info = await stat(resolved, { bigint: true });
        if (!info.isDirectory()) throw new Error("storage_root_invalid");
        return { real: resolved, dev: info.dev, ino: info.ino };
      })();
      rootPromise.catch(() => { rootPromise = null; });
    }
    return rootPromise;
  }

  async function assertRootUnchanged(root) {
    const current = await stat(root.real, { bigint: true }).catch(() => {
      throw new Error("storage_root_changed");
    });
    if (!current.isDirectory() || current.dev !== root.dev || current.ino !== root.ino) {
      throw new Error("storage_root_changed");
    }
  }

  // Walk the key from the pinned root. `mode` is "get", "put", or "remove".
  // Returns { path, exists } for the leaf. Rejects any segment that is a
  // symlink (which also covers Windows junctions) or whose type contradicts
  // its position in the key.
  async function walk(key, mode) {
    assertObjectKeyShape(key);
    const root = await containmentRoot();
    await assertRootUnchanged(root);
    const segments = key.split("/");
    let currentPath = root.real;
    for (let index = 0; index < segments.length; index += 1) {
      const isLeaf = index === segments.length - 1;
      currentPath = path.join(currentPath, segments[index]);
      let info = await lstatOrNull(currentPath);
      if (info === null) {
        if (isLeaf || mode !== "put") return { path: currentPath, exists: false };
        await mkdir(currentPath).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        info = await lstat(currentPath);
      }
      if (info.isSymbolicLink()) throw new Error("storage_link_unsafe");
      if (isLeaf) {
        if (!info.isFile() || info.nlink > 1) throw new Error("storage_link_unsafe");
        return { path: currentPath, exists: true };
      }
      if (!info.isDirectory()) throw new Error("object_parent_missing");
    }
    throw new Error("object_key_shape_violation");
  }

  async function put(key, bytes, mime) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("bytes_required");
    const expectedMime = mimeForObjectKey(key);
    if (expectedMime !== mime) throw new Error("mime_extension_mismatch");
    const target = await walk(key, "put");
    const sha256 = sha256Hex(bytes);
    try {
      await writeFile(target.path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("object_key_exists");
      throw error;
    }
    return { key, sha256, bytes: bytes.length };
  }

  async function get(key, maxBytes) {
    const limit = validateReadLimit(maxBytes === undefined ? configuredLimit : maxBytes);
    const target = await walk(key, "get");
    if (!target.exists) return null;
    const handle = await open(target.path, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error("storage_link_unsafe");
      if (info.size > limit) throw new Error("object_size_exceeded");
      const expected = info.size;
      const chunks = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit - total));
        // eslint-disable-next-line no-await-in-loop -- sequential bounded read
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > limit) throw new Error("object_size_exceeded");
        chunks.push(chunk.subarray(0, bytesRead));
        if (total === limit) break;
      }
      // A file that grew or shrank after the size check must not be returned
      // as a silently truncated/partial body.
      const after = await handle.stat();
      if (after.size > limit) throw new Error("object_size_exceeded");
      if (after.size !== expected || total !== expected) {
        throw new Error("storage_file_changed");
      }
      return { bytes: Buffer.concat(chunks, total), mime: mimeForObjectKey(key) };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async function remove(key) {
    const target = await walk(key, "remove");
    if (!target.exists) return { key, deleted: false };
    await rm(target.path, { force: true });
    return { key, deleted: true };
  }

  return { kind: "local-fs", put, get, remove };
}
