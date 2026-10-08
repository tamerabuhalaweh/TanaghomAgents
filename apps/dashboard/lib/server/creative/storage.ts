import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Provider-neutral object-storage interface. P1b ships the local-filesystem
// backend only (disposable/test path, no credentials, no network). The key
// space is validated before touching disk: only server-built keys shaped by
// object-keys.ts ever reach these functions.
export interface CreativeStorage {
  readonly kind: string;
  put(key: string, bytes: Buffer, mime: string): Promise<{ sha256: string }>;
  get(key: string): Promise<{ bytes: Buffer; mime: string } | null>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^t\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\/v[0-9]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|html)$/;
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  mp4: "video/mp4", wav: "audio/wav", mp3: "audio/mpeg", html: "text/html",
};

export function uploadDir() {
  return process.env.CREATIVE_UPLOAD_DIR ?? path.join(process.cwd(), "tmp", "creative-uploads");
}

export function keyToRelativePath(key: string) {
  if (!KEY_RE.test(key)) throw new Error("object_key_shape_violation");
  if (key.includes("..")) throw new Error("object_key_traversal");
  return key;
}

export function sha256Hex(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function localStorage(dir = uploadDir()): CreativeStorage {
  async function filePath(key: string) {
    return path.join(dir, keyToRelativePath(key));
  }
  return {
    kind: "local-fs",
    async put(key, bytes, mime) {
      const expected = MIME_BY_EXT[key.split(".").pop()!.toLowerCase()];
      if (expected !== mime) throw new Error("mime_extension_mismatch");
      const target = await filePath(key);
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("object_key_exists");
        throw error;
      }
      return { sha256: sha256Hex(bytes) };
    },
    async get(key) {
      const target = await filePath(key);
      try {
        const bytes = await readFile(target);
        const ext = key.split(".").pop()!.toLowerCase();
        return { bytes, mime: MIME_BY_EXT[ext] };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(await filePath(key), { force: true });
    },
  };
}
