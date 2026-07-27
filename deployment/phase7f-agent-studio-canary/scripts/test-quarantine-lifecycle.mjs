#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_TEST_URL is required; quarantine proof refuses DATABASE_URL.");
}

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const operator = join(
  root,
  "deployment",
  "phase7f-agent-studio-canary",
  "scripts",
  "canary-operator.mjs",
);
const organizationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000001";
const profileId = "7d000000-0000-4000-8000-000000000002";
const canaryId = "phase7f-canary-20990101T000000Z";
const restoredReason = "Disposable quarantine regression boundary";
const hash = (value) => `sha256:${createHash("sha256")
  .update(typeof value === "string" ? value : JSON.stringify(value))
  .digest("hex")}`;

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: "tanaghom-phase7f-quarantine-test",
});

function runQuarantine(versionId) {
  const result = spawnSync(
    process.execPath,
    [
      operator,
      "quarantine",
      canaryId,
      Buffer.from(restoredReason, "utf8").toString("base64"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TANAGHOM_CANARY_ORGANIZATION_ID: organizationId,
        TANAGHOM_CANARY_OWNER_ID: ownerId,
        TANAGHOM_CANARY_AGENT_VERSION_ID: versionId,
        TANAGHOM_CANARY_RUNTIME_PROFILE_ID: profileId,
      },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

try {
  const payload = {
    code: "phase7f_quarantine_probe",
    display_name: "Phase 7F Quarantine Probe",
    description: "Disposable bilingual agent used only to prove transactional canary cleanup.",
    objective: "Prove unfinished simulation work is safely quarantined.",
    responsibility: "Create no external action and retain terminal failure evidence.",
    tone: "Clear and bounded",
    brand_profile_key: "brand/tanaghom",
    languages: ["en", "ar"],
    knowledge_keys: [],
    skills: [{
      skill_source: "platform",
      skill_version_id: "72000000-0000-4000-8000-000000000001",
      operating_mode: "shadow",
      approval_required: true,
      constraints: {},
    }],
    integrations: [],
    policy: {
      business_timezone: "Asia/Amman",
      business_hours: [],
      allowed_channels: ["facebook", "instagram"],
      consent_required: false,
      max_steps: 2,
      max_tool_calls: 2,
      max_retries: 1,
      max_concurrency: 1,
      max_runtime_seconds: 120,
      max_tokens: 4000,
      max_daily_actions: 0,
      max_actions_per_minute: 0,
      max_follow_ups_per_contact: 0,
      monthly_budget: 0,
      allowed_record_types: ["campaign"],
      allowed_action_types: ["proposal.create"],
      approval_actions: ["provider.external_write"],
      approval_roles: ["owner", "reviewer"],
      approval_expiry_minutes: 60,
      parameter_bound_approval: true,
      escalation_conditions: ["Escalate on missing evidence or policy conflict."],
    },
  };
  const created = await pool.query(
    `SELECT * FROM tanaghom.create_organization_agent_draft(
       $1::uuid,$2::uuid,$3::jsonb,$4::text,NULL
     )`,
    [organizationId, ownerId, payload, hash("phase7f-quarantine-probe")],
  );
  const versionId = created.rows[0].agent_version_id;
  await pool.query(
    `SELECT * FROM tanaghom.transition_organization_agent_version(
       $1::uuid,$2::uuid,$3::uuid,'validate',$4::jsonb
     )`,
    [
      organizationId,
      ownerId,
      versionId,
      { valid: true, validator_version: "phase7f-quarantine-regression.v1" },
    ],
  );
  const scenario = (await pool.query(
    `SELECT id FROM tanaghom.organization_agent_test_scenarios
      WHERE agent_version_id=$1::uuid AND language='en' AND scenario_kind='success'`,
    [versionId],
  )).rows[0];
  const input = {
    contract_version: "phase7f.agent-studio-canary.v1",
    canary_id: canaryId,
    scenario_kind: "success",
    language: "en",
    content: "Disposable cleanup test with no external action.",
    simulation_only: true,
    external_action_budget: 0,
  };
  const queued = await pool.query(
    `SELECT * FROM tanaghom.queue_organization_agent_job(
       $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,NULL,
       $6::uuid,$7::text,$8::text,'scenario','facebook',false,'en',$9::jsonb
     )`,
    [
      organizationId,
      ownerId,
      versionId,
      profileId,
      scenario.id,
      randomUUID(),
      `${canaryId}:quarantine`,
      hash(input),
      input,
    ],
  );
  await pool.query(
    `UPDATE tanaghom.agent_runtime_controls
        SET emergency_stop=false,reason='Disposable quarantine claim'
      WHERE singleton`,
  );
  const claimed = await pool.query(
    "SELECT * FROM tanaghom.claim_organization_agent_job('phase7f_quarantine_probe')",
  );
  assert.equal(claimed.rowCount, 1);
  assert.equal(claimed.rows[0].job_id, queued.rows[0].job_id);

  const first = runQuarantine(versionId);
  assert.equal(first.emergency_stop, true);
  assert.equal(first.jobs_quarantined, 1);
  const second = runQuarantine(versionId);
  assert.equal(second.emergency_stop, true);
  assert.equal(second.jobs_quarantined, 0);

  const evidence = (await pool.query(
    `SELECT
       job.status,job.error_code,run.status AS run_status,
       (SELECT count(*)::int
          FROM tanaghom.organization_agent_runtime_events event
         WHERE event.job_id=job.id AND event.event_type='run_failed'
           AND event.actor_ref='phase7f-canary-restore') AS failure_events,
       (SELECT emergency_stop FROM tanaghom.agent_runtime_controls WHERE singleton) AS stopped,
       (SELECT reason FROM tanaghom.agent_runtime_controls WHERE singleton) AS stop_reason
     FROM tanaghom.organization_agent_jobs job
     JOIN tanaghom.organization_agent_runs run ON run.job_id=job.id
     WHERE job.id=$1::uuid`,
    [queued.rows[0].job_id],
  )).rows[0];
  assert.deepEqual(evidence, {
    status: "cancelled",
    error_code: "phase7f_canary_quarantined",
    run_status: "cancelled",
    failure_events: 1,
    stopped: true,
    stop_reason: restoredReason,
  });
  console.log(
    "PASS: a claimed canary job was transactionally quarantined, one immutable failure event was retained, and repeated restoration was idempotent.",
  );
} finally {
  await pool.end();
}
