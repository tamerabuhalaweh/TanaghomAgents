import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolves a shared repository `config/<filename>` across both repo-root test
 * runs (`C:\...\TanaghomAgents`) and production workspace builds where Next.js
 * runs with `process.cwd()` set inside `apps/dashboard` (`/app/apps/dashboard`).
 */
export function resolveCreativeConfigPath(filename: string, startDir: string = process.cwd()): string {
  // Config JSONs live outside `apps/dashboard` in `/app/config`; opt out of
  // Turbopack whole-project file tracing since Docker copies `/app/config`.
  let current = path.resolve(/*turbopackIgnore: true*/ startDir);
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(current, "config", filename);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const error = new Error(`Creative config file not found: config/${filename}`) as Error & { code?: string };
  error.code = "ENOENT";
  throw error;
}
