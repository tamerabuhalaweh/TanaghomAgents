import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const cwd = fileURLToPath(root);

test("Phase 7A recovery contract, schemas, hashes, and safe skill exports validate", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-skill-registry.mjs"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /eight immutable platform skills/);
});

test("Skill Registry migration enforces immutable, tenant-aware, least-privilege boundaries", async () => {
  const up = await readFile(new URL(
    "packages/database/migrations/0026_skill_registry.up.sql",
    root,
  ), "utf8");
  const down = await readFile(new URL(
    "packages/database/migrations/0026_skill_registry.down.sql",
    root,
  ), "utf8");
  const databaseTest = await readFile(new URL(
    "packages/database/tests/skill_registry.sql",
    root,
  ), "utf8");

  for (const table of [
    "skill_definitions",
    "skill_versions",
    "agent_skill_bindings",
    "skill_references",
    "skill_audit_events",
  ]) {
    assert.match(up, new RegExp(`CREATE TABLE tanaghom\\.${table}`));
    assert.match(down, new RegExp(`DROP TABLE tanaghom\\.${table}`));
  }
  assert.match(up, /published skill version content cannot be mutated/);
  assert.match(up, /cross-tenant agent-to-skill binding is forbidden/);
  assert.match(up, /unknown pinned n8n executor/);
  assert.match(up, /tanaghom_n8n_worker,tanaghom_conversation_worker/);
  assert.match(up, /GRANT SELECT[\s\S]*TO tanaghom_api,tanaghom_readonly/);
  assert.match(down, /cannot roll back 0026 while organization-owned skill data or bindings exist/);
  assert.match(databaseTest, /wildcard permission unexpectedly succeeded/);
  assert.match(databaseTest, /cross-tenant binding unexpectedly succeeded/);
  assert.match(databaseTest, /n8n registry read unexpectedly succeeded/);
});

test("authenticated operations API exposes a read-only tenant-filtered Skill Registry shape", async () => {
  const route = await readFile(new URL("apps/dashboard/app/api/operations/route.ts", root), "utf8");
  const types = await readFile(new URL("apps/dashboard/components/operations-context.tsx", root), "utf8");
  assert.match(route, /BEGIN TRANSACTION READ ONLY/);
  assert.match(route, /definition\.organization_id IS NULL OR definition\.organization_id=\$1/);
  assert.match(route, /tanaghom\.agent_skill_bindings/);
  assert.match(route, /contract_version: "tanaghom\.skill-registry\.v1"/);
  assert.match(types, /interface SkillRegistrySnapshot/);
  assert.match(types, /permission_manifest/);
  assert.doesNotMatch(route, /credential_ciphertext|credential_nonce|credential_auth_tag/);
});
