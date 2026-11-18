import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a configured super-admin allowlist disables the platform-organization fallback", () => {
  const service = read("apps/dashboard/lib/server/super-admin.ts");
  assert.match(service, /export function isPlatformSuperAdmin/);
  assert.match(service, /if \(!normalized \|\| !allowedEmails\.has\(normalized\)\) return false;/);
  assert.match(service, /if \(!isPlatformSuperAdmin\(user, email\)\) throw new SuperAdminNotFound/);
  // Production must fail closed when no allowlist is configured.
  assert.match(service, /if \(production && allowedEmails\.size === 0\) return false;/);
  assert.doesNotMatch(
    service,
    /allowedEmails\.has\(email\)\)\s*\|\|\s*\(user\.organizationId === PLATFORM_ORGANIZATION_ID/,
  );
});
