import "server-only";

import { createHash } from "node:crypto";

import {
  createCreativeStorage as createSharedCreativeStorage,
  MAX_OBJECT_READ_BYTES,
} from "@tanaghom/creative-runtime/storage/factory";
import type { CreativeStorage, CreativeStorageOptions } from "@tanaghom/creative-runtime/storage/factory";

// Server-only storage entry point. Backend selection, credential handling,
// and production fail-closed semantics live in the shared factory
// (@tanaghom/creative-runtime/storage/factory); this module is a thin,
// provider-neutral wrapper so no dashboard route ever constructs a backend
// directly. Never import from client components.
export type { CreativeStorage };

export function creativeStorage(options?: CreativeStorageOptions): CreativeStorage {
  return createSharedCreativeStorage(options);
}

export function sha256Hex(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export { MAX_OBJECT_READ_BYTES };
