// Local-filesystem private storage adapter (dependency-free). Same key
// space and semantics as the dashboard server backend: tenant-scoped
// immutable keys only, exclusive create, mime/extension agreement. Used by
// the design render worker CLI and disposable harnesses; production
// backends implement the same positional put/get/remove surface.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256Hex } from "./keys.mjs";

const KEY_RE = /^t\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\/v[0-9]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|html)$/;
const MIME_BY_EXT = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  html: "text/html",
});

export function createLocalFsStorage({ dir }) {
  if (typeof dir !== "string" || dir.length === 0) throw new Error("storage_dir_required");
  async function filePath(key) {
    if (!KEY_RE.test(key)) throw new Error("object_key_shape_violation");
    if (key.includes("..")) throw new Error("object_key_traversal");
    return path.join(dir, key);
  }
  return Object.freeze({
    kind: "local-fs",
    async put(key, bytes, mime) {
      const expected = MIME_BY_EXT[key.split(".").pop().toLowerCase()];
      if (expected !== mime) throw new Error("mime_extension_mismatch");
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("bytes_required");
      const target = await filePath(key);
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        if (error && error.code === "EEXIST") throw new Error("object_key_exists");
        throw error;
      }
      return { sha256: sha256Hex(bytes) };
    },
    async get(key) {
      const target = await filePath(key);
      try {
        const bytes = await readFile(target);
        return { bytes, mime: MIME_BY_EXT[key.split(".").pop().toLowerCase()] };
      } catch (error) {
        if (error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(await filePath(key), { force: true });
    },
  });
}
