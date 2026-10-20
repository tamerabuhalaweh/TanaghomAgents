// Local-filesystem private storage adapter (dependency-free). Same key
// space and semantics as the dashboard server backend: tenant-scoped
// immutable keys only, exclusive create, mime/extension agreement, and
// bounded reads. This is a thin wrapper over the shared contained-fs
// primitive so every local path shares one containment implementation.
// Used by render/segment worker CLIs, tests, and disposable harnesses;
// production backends implement the same put/get/remove surface. Local
// storage is never eligible in production (see storage/factory.mjs).
import { createContainedFs } from "./contained-fs.mjs";

export function createLocalFsStorage({ dir, readLimitBytes } = {}) {
  return createContainedFs({ dir, readLimitBytes });
}
