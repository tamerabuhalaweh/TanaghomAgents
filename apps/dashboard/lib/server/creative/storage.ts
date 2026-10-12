import "server-only";

import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Provider-neutral object-storage interface. P1b ships the local-filesystem
// backend only (disposable/test path, no credentials, no network). The key
// space is validated before touching disk: only server-built keys shaped by
// object-keys.ts ever reach these functions.
export interface CreativeStorage {
  readonly kind: string;
  put(key: string, bytes: Buffer, mime: string): Promise<{ sha256: string }>;
  get(key: string, maxBytes?: number): Promise<{ bytes: Buffer; mime: string } | null>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^t\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\/v[0-9]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|ogg|flac|aac|html)$/;
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  mp4: "video/mp4", wav: "audio/wav", mp3: "audio/mpeg", ogg:"audio/ogg", flac:"audio/flac", aac:"audio/aac", html: "text/html",
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
    async get(key, maxBytes) {
      const target = await filePath(key);
      try {
        let bytes:Buffer;
        if(maxBytes===undefined)bytes=await readFile(target);
        else {
          if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>25*1024*1024)throw new Error("object_read_bound_invalid");
          const file=await open(target,"r");
          try {
            if((await file.stat()).size>maxBytes)throw new Error("object_size_exceeded");
            const chunks:Buffer[]=[];let size=0;
            for(;;){const chunk=Buffer.alloc(Math.min(65536,maxBytes-size+1));const {bytesRead}=await file.read(chunk,0,chunk.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maxBytes)throw new Error("object_size_exceeded");chunks.push(chunk.subarray(0,bytesRead));}
            bytes=Buffer.concat(chunks,size);
          }finally{await file.close();}
        }
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
