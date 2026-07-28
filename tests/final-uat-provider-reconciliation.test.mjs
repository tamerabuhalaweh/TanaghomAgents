import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("Final UAT provider reconciliation changes only the reviewed Postiz application allowlist", () => {
  const compose = read("deployment/dashboard-canary/docker-compose.yml");
  assert.match(
    compose,
    /POSTIZ_ALLOWED_BASE_URLS: https:\/\/postiz\.155-117-45-45\.sslip\.io\/api\/public\/v1/,
  );
  assert.doesNotMatch(compose, /POSTIZ_ALLOWED_BASE_URLS:.*163-123-180-104/);
  assert.match(compose, /AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED: "false"/);
  assert.match(compose, /GHL_WEBHOOK_INGRESS_ENABLED: "false"/);
  assert.match(compose, /GHL_CONTACT_SYNC_ENABLED: "false"/);
  assert.match(compose, /GHL_ACTION_RUNTIME_ENABLED: "false"/);
  assert.match(compose, /POSTIZ_AUTOMATION_RUNTIME_READY: "true"/);
  assert.match(compose, /GHL_ACTION_RUNTIME_READY: "true"/);
});

test("Final UAT provider package refuses credentials, channels, actions and unsafe rollback", () => {
  const directory = new URL(
    "deployment/final-uat-provider-reconciliation/scripts/",
    root,
  );
  const scripts = readdirSync(directory)
    .filter((name) => name.endsWith(".sh"))
    .map((name) => readFileSync(join(fileURLToPath(directory), name), "utf8"))
    .join("\n");
  const runbook = read("deployment/final-uat-provider-reconciliation/RUNBOOK.md");

  assert.match(scripts, /EXPECTED_MIGRATION=0033_agent_runtime_certification_evidence/);
  assert.match(scripts, /assert_pre_onboarding_state/);
  assert.match(scripts, /provider_state_fingerprint/);
  assert.match(scripts, /assert_provider_network_reachable/);
  assert.match(scripts, /assert_n8n_ids_unchanged/);
  assert.match(scripts, /firewall\.before/);
  assert.match(scripts, /nginx\.before\.sha256/);
  assert.match(scripts, /squid\.before\.sha256/);
  assert.match(scripts, /ROLLBACK-TANAGHOM-UAT-PROVIDER-ALLOWLIST/);
  assert.doesNotMatch(scripts, /GHL_WEBHOOK_INGRESS_ENABLED=true/);
  assert.doesNotMatch(scripts, /GHL_CONTACT_SYNC_ENABLED=true/);
  assert.doesNotMatch(scripts, /GHL_ACTION_RUNTIME_ENABLED=true/);
  assert.doesNotMatch(scripts, /AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=true/);
  assert.match(runbook, /does not change a credential/i);
  assert.match(runbook, /customer-owned gates after deployment/i);
  assert.match(runbook, /must be rotated/i);
});
