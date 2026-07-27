#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const [action, canaryId, encodedReason] = process.argv.slice(2);
const allowed = new Set([
  "check-database",
  "snapshot-controls",
  "queue",
  "assert-exclusive",
  "unlock",
  "lock",
  "finalize-next",
  "verify",
  "quarantine",
]);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!allowed.has(action) || !/^phase7f-canary-[0-9]{8}T[0-9]{6}Z$/.test(canaryId ?? "")) {
  throw new Error(`usage: canary-operator.mjs ${[...allowed].join("|")} phase7f-canary-YYYYMMDDTHHMMSSZ [reason-base64]`);
}

const ids = {
  organization: process.env.TANAGHOM_CANARY_ORGANIZATION_ID,
  owner: process.env.TANAGHOM_CANARY_OWNER_ID,
  version: process.env.TANAGHOM_CANARY_AGENT_VERSION_ID,
  profile: process.env.TANAGHOM_CANARY_RUNTIME_PROFILE_ID,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!Object.values(ids).every((value) => uuid.test(value ?? ""))) {
  throw new Error("exact organization, owner, version and runtime profile UUIDs are required");
}

const connectionUrl = new URL(process.env.DATABASE_URL);
if (process.env.TANAGHOM_DATABASE_SSL_MODE) {
  if (process.env.TANAGHOM_DATABASE_SSL_MODE !== "verify-full") {
    throw new Error("TANAGHOM_DATABASE_SSL_MODE must be verify-full");
  }
  connectionUrl.searchParams.set("sslmode", "verify-full");
}
const client = new pg.Client({
  connectionString: connectionUrl.toString(),
  application_name: "tanaghom-phase7f-agent-studio-canary",
});
await client.connect();

function decodeReason(value) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("a base64-encoded original runtime-stop reason is required");
  }
  const reason = Buffer.from(value, "base64").toString("utf8");
  if (Buffer.from(reason, "utf8").toString("base64") !== value
    || reason.trim().length < 3 || reason.length > 500) {
    throw new Error("original runtime-stop reason is invalid");
  }
  return reason;
}

async function checkDatabase() {
  await client.query("BEGIN READ ONLY");
  try {
    const migration = (await client.query(
      "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
    )).rows[0]?.version;
    if (migration !== "0032_gemma_served_model_profile") {
      throw new Error("unexpected database migration");
    }
    const profile = await client.query(`
      SELECT code,model_name,planner_contract_version,planner_schema_ref,
        prompt_version,parser_version,lifecycle_state
      FROM tanaghom.agent_runtime_profiles
      WHERE id=$1::uuid`,
    [ids.profile]);
    if (profile.rowCount !== 1
      || profile.rows[0].code !== "gemma4_26b_a4b_canary_strict_v1"
      || profile.rows[0].model_name !== "gemma4-26b-a4b-canary"
      || profile.rows[0].planner_contract_version !== "phase7.agent-runtime-plan.v1"
      || profile.rows[0].planner_schema_ref
        !== "packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json"
      || profile.rows[0].prompt_version !== "policy-resolved-agent.v1"
      || profile.rows[0].parser_version !== "tanaghom.strict-json.v1"
      || profile.rows[0].lifecycle_state !== "validated") {
      throw new Error("exact validated Gemma served-model runtime profile is required");
    }
    const identity = await client.query(`
      SELECT version.id,version.lifecycle_state,version.languages,
        definition.organization_id,owner.id AS owner_id,
        policy.max_daily_actions,policy.monthly_budget
      FROM tanaghom.organization_agent_versions version
      JOIN tanaghom.organization_agent_definitions definition
        ON definition.id=version.agent_id
      JOIN tanaghom.organization_agent_policies policy
        ON policy.agent_version_id=version.id
      JOIN tanaghom.app_users owner
        ON owner.id=$2::uuid AND owner.organization_id=definition.organization_id
       AND owner.kind='human' AND owner.role='owner' AND owner.is_active=true
       AND owner.accepted_at IS NOT NULL
      WHERE version.id=$3::uuid AND definition.organization_id=$1::uuid`,
    [ids.organization, ids.owner, ids.version]);
    if (identity.rowCount !== 1 || identity.rows[0].lifecycle_state !== "validated") {
      throw new Error("exact tenant-bound validated Agent Studio version and owner are required");
    }
    if (identity.rows[0].languages.length !== 2
      || !identity.rows[0].languages.includes("en")
      || !identity.rows[0].languages.includes("ar")) {
      throw new Error("the canary version must be exactly bilingual English and Arabic");
    }
    const scenarios = await client.query(`
      SELECT language,count(*)::int AS count
      FROM tanaghom.organization_agent_test_scenarios
      WHERE organization_id=$1::uuid AND agent_version_id=$2::uuid
        AND scenario_kind='success'
      GROUP BY language ORDER BY language`,
    [ids.organization, ids.version]);
    if (scenarios.rowCount !== 2
      || scenarios.rows.some((row) => row.count !== 1)
      || JSON.stringify(scenarios.rows.map((row) => row.language)) !== JSON.stringify(["ar", "en"])) {
      throw new Error("exactly one English and one Arabic success scenario are required");
    }
    const boundary = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM tanaghom.organization_agent_jobs
          WHERE status IN ('queued','running','waiting_approval')) AS open_jobs,
        (SELECT count(*)::int FROM tanaghom.organization_agent_jobs
          WHERE input->>'canary_id'=$1) AS canary_jobs,
        (SELECT count(*)::int FROM tanaghom.organization_agent_runtime_certifications
          WHERE organization_id=$2::uuid AND agent_version_id=$3::uuid) AS certifications,
        (SELECT count(*)::int FROM tanaghom.agent_runtime_controls
          WHERE singleton AND emergency_stop=true) AS runtime_stopped,
        (SELECT count(*)::int FROM tanaghom.agent_runtime_executor_adapters
          WHERE enabled=true) AS enabled_adapters`,
    [canaryId, ids.organization, ids.version])).rows[0];
    if (boundary.open_jobs !== 0 || boundary.canary_jobs !== 0
      || boundary.certifications !== 0 || boundary.runtime_stopped !== 1
      || boundary.enabled_adapters !== 0) {
      throw new Error("runtime work, certification, stop, adapter, or canary identity baseline is unsafe");
    }
    await client.query("ROLLBACK");
    console.log(JSON.stringify({
      database_tls: "verified",
      transaction: "read_only",
      migration,
      runtime_profile_id: ids.profile,
      model_name: profile.rows[0].model_name,
      agent_version_id: ids.version,
      languages: ["en", "ar"],
      scenarios: 2,
      runtime_stopped: true,
      provider_adapters_enabled: 0,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function snapshotControls() {
  const row = (await client.query(
    "SELECT emergency_stop,reason FROM tanaghom.agent_runtime_controls WHERE singleton",
  )).rows[0];
  if (!row?.emergency_stop) throw new Error("shared runtime emergency stop is not active");
  console.log(JSON.stringify({
    emergency_stop: true,
    reason_base64: Buffer.from(row.reason, "utf8").toString("base64"),
  }));
}

async function queue() {
  await client.query("BEGIN");
  try {
    const policy = (await client.query(`
      SELECT policy.allowed_channels,policy.consent_required
      FROM tanaghom.organization_agent_versions version
      JOIN tanaghom.organization_agent_policies policy
        ON policy.agent_version_id=version.id
      WHERE version.id=$1::uuid AND version.organization_id=$2::uuid
        AND version.lifecycle_state='validated'
      FOR SHARE OF version,policy`,
    [ids.version, ids.organization])).rows[0];
    if (!policy) throw new Error("validated canary version disappeared");
    const scenarios = await client.query(`
      SELECT id,code,language,scenario_kind,expected_behavior
      FROM tanaghom.organization_agent_test_scenarios
      WHERE organization_id=$1::uuid AND agent_version_id=$2::uuid
        AND scenario_kind='success'
      ORDER BY CASE language WHEN 'en' THEN 1 ELSE 2 END`,
    [ids.organization, ids.version]);
    if (scenarios.rowCount !== 2) throw new Error("bilingual success scenarios changed");
    const correlationId = randomUUID();
    const queued = [];
    for (const scenario of scenarios.rows) {
      const input = {
        contract_version: "phase7f.agent-studio-canary.v1",
        canary_id: canaryId,
        scenario_kind: "success",
        language: scenario.language,
        expected_behavior: scenario.expected_behavior,
        content: scenario.language === "ar"
          ? "طلب اختبار عربي منزوع الهوية ومقيّد بالسياسة. اقترح نتيجة محاكاة فقط ولا تنفذ أي إجراء خارجي."
          : "De-identified, policy-bounded English test request. Propose a simulation result only and perform no external action.",
        simulation_only: true,
        external_action_budget: 0,
      };
      const result = await client.query(`
        SELECT * FROM tanaghom.queue_organization_agent_job(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,NULL,
          $6::uuid,$7::text,tanaghom.agent_runtime_sha256($8::jsonb),
          'scenario',$9::text,$10::boolean,$11::text,$8::jsonb
        )`,
      [
        ids.organization,
        ids.owner,
        ids.version,
        ids.profile,
        scenario.id,
        correlationId,
        `${canaryId}:${scenario.language}:success`,
        input,
        policy.allowed_channels?.[0] ?? null,
        Boolean(policy.consent_required),
        scenario.language,
      ]);
      queued.push({
        job_id: result.rows[0].job_id,
        language: scenario.language,
        scenario_id: scenario.id,
        created: result.rows[0].created,
      });
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ correlation_id: correlationId, jobs: queued }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function assertExclusive() {
  const result = (await client.query(`
    SELECT
      count(*) FILTER (WHERE input->>'canary_id'=$1)::int AS canary_open,
      count(*) FILTER (WHERE input->>'canary_id' IS DISTINCT FROM $1)::int AS other_open
    FROM tanaghom.organization_agent_jobs
    WHERE status IN ('queued','running','waiting_approval')`,
  [canaryId])).rows[0];
  if (result.canary_open < 1 || result.canary_open > 2 || result.other_open !== 0) {
    throw new Error("the canary is not the exclusive shared-runtime workload");
  }
  console.log(JSON.stringify(result));
}

async function unlock() {
  await assertExclusive();
  const result = await client.query(`
    UPDATE tanaghom.agent_runtime_controls
       SET emergency_stop=false,
           reason=$1,
           updated_at=statement_timestamp()
     WHERE singleton AND emergency_stop=true
     RETURNING emergency_stop,reason,updated_at`,
  [`${canaryId}: one simulation-only n8n execution`]);
  if (result.rowCount !== 1) throw new Error("shared runtime stop could not open");
  console.log(JSON.stringify(result.rows[0]));
}

async function lock() {
  const reason = decodeReason(encodedReason);
  const result = await client.query(`
    UPDATE tanaghom.agent_runtime_controls
       SET emergency_stop=true,reason=$1,updated_at=statement_timestamp()
     WHERE singleton
     RETURNING emergency_stop,reason,updated_at`,
  [reason]);
  if (result.rowCount !== 1 || !result.rows[0].emergency_stop) {
    throw new Error("shared runtime stop could not be restored");
  }
  console.log(JSON.stringify({ emergency_stop: true, reason_restored: true }));
}

async function finalizeNext() {
  await client.query("BEGIN");
  try {
    const result = await client.query(`
      SELECT job.id AS job_id,job.language,job.scenario_id,run.id AS run_id,
        count(invocation.id)::int AS invocation_count,
        count(*) FILTER (WHERE invocation.status='succeeded')::int AS succeeded,
        count(*) FILTER (WHERE invocation.status IN (
          'waiting_approval','simulation_ready','ready','in_progress'
        ))::int AS unfinished,
        count(*) FILTER (WHERE invocation.simulation_only=false)::int AS non_simulation,
        count(*) FILTER (WHERE invocation.provider_reference IS NOT NULL
          OR invocation.provider_dispatch_id IS NOT NULL)::int AS provider_actions,
        coalesce(sum(invocation.actual_cost),0)::numeric AS actual_cost
      FROM tanaghom.organization_agent_jobs job
      JOIN tanaghom.organization_agent_runs run ON run.job_id=job.id
      LEFT JOIN tanaghom.organization_agent_invocations invocation
        ON invocation.run_id=run.id
      WHERE job.organization_id=$1::uuid AND job.agent_version_id=$2::uuid
        AND job.input->>'canary_id'=$3 AND job.status='running'
        AND run.status='dispatching'
      GROUP BY job.id,job.language,job.scenario_id,run.id
      ORDER BY run.started_at,run.id`,
    [ids.organization, ids.version, canaryId]);
    if (result.rowCount !== 1) {
      throw new Error("exactly one executed canary run is required for finalization");
    }
    const row = result.rows[0];
    if (row.invocation_count < 1 || row.succeeded !== row.invocation_count
      || row.unfinished !== 0 || row.non_simulation !== 0
      || row.provider_actions !== 0 || Number(row.actual_cost) !== 0) {
      throw new Error("canary run is not a terminal zero-action simulation");
    }
    const summary = {
      contract_version: "phase7.agent-runtime-final-summary.v1",
      canary_id: canaryId,
      simulation: true,
      external_action_count: 0,
      language: row.language,
      scenario_kind: "success",
      settled_by: "phase7f_agent_studio_canary",
    };
    await client.query(
      "SELECT tanaghom.finalize_agent_runtime_run($1::uuid,'succeeded',$2::jsonb,'passed')",
      [row.run_id, summary],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({
      job_id: row.job_id,
      run_id: row.run_id,
      language: row.language,
      scenario_result: "passed",
      external_actions: 0,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function verify() {
  await client.query("BEGIN READ ONLY");
  try {
    const result = (await client.query(`
      SELECT
        count(DISTINCT job.id)::int AS jobs,
        count(DISTINCT job.id) FILTER (
          WHERE job.status='succeeded' AND job.scenario_result='passed'
        )::int AS passed_jobs,
        count(DISTINCT job.language)::int AS languages,
        count(DISTINCT run.id) FILTER (WHERE run.status='succeeded')::int AS runs,
        count(invocation.id)::int AS invocations,
        count(*) FILTER (WHERE invocation.status<>'succeeded'
          OR invocation.simulation_only=false)::int AS unsafe_invocations,
        count(*) FILTER (WHERE invocation.provider_reference IS NOT NULL
          OR invocation.provider_dispatch_id IS NOT NULL)::int AS provider_actions,
        coalesce(sum(invocation.actual_cost),0)::numeric AS actual_cost
      FROM tanaghom.organization_agent_jobs job
      JOIN tanaghom.organization_agent_runs run ON run.job_id=job.id
      JOIN tanaghom.organization_agent_invocations invocation ON invocation.run_id=run.id
      WHERE job.organization_id=$1::uuid AND job.agent_version_id=$2::uuid
        AND job.input->>'canary_id'=$3`,
    [ids.organization, ids.version, canaryId])).rows[0];
    const state = (await client.query(`
      SELECT
        (SELECT lifecycle_state FROM tanaghom.organization_agent_versions
          WHERE id=$1::uuid AND organization_id=$2::uuid) AS lifecycle_state,
        (SELECT count(*)::int FROM tanaghom.organization_agent_runtime_certifications
          WHERE agent_version_id=$1::uuid AND organization_id=$2::uuid) AS certifications,
        (SELECT count(*)::int FROM tanaghom.agent_runtime_controls
          WHERE singleton AND emergency_stop=true) AS runtime_stopped,
        (SELECT count(*)::int FROM tanaghom.agent_runtime_executor_adapters
          WHERE enabled=true) AS enabled_adapters`,
    [ids.version, ids.organization])).rows[0];
    if (result.jobs !== 2 || result.passed_jobs !== 2 || result.languages !== 2
      || result.runs !== 2 || result.invocations < 2
      || result.unsafe_invocations !== 0 || result.provider_actions !== 0
      || Number(result.actual_cost) !== 0 || state.lifecycle_state !== "validated"
      || state.certifications !== 0 || state.runtime_stopped !== 1
      || state.enabled_adapters !== 0) {
      throw new Error("bilingual canary evidence or restored safety boundary is incomplete");
    }
    await client.query("ROLLBACK");
    console.log(JSON.stringify({
      ...result,
      ...state,
      scenario_languages: ["en", "ar"],
      external_actions: 0,
      certification_recorded: false,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function quarantine() {
  const reason = decodeReason(encodedReason);
  await client.query("BEGIN");
  try {
    await client.query(`
      UPDATE tanaghom.agent_runtime_controls
         SET emergency_stop=true,reason=$1,updated_at=statement_timestamp()
       WHERE singleton`,
    [reason]);
    const unsafe = (await client.query(`
      SELECT count(*)::int AS count
      FROM tanaghom.organization_agent_invocations invocation
      JOIN tanaghom.organization_agent_jobs job ON job.id=invocation.job_id
      WHERE job.input->>'canary_id'=$1
        AND (
          invocation.simulation_only=false
          OR invocation.provider_reference IS NOT NULL
          OR invocation.provider_dispatch_id IS NOT NULL
          OR invocation.actual_cost<>0
        )`,
    [canaryId])).rows[0].count;
    if (unsafe !== 0) {
      await client.query("COMMIT");
      console.log(JSON.stringify({
        emergency_stop: true,
        reason_restored: true,
        unsafe_evidence_preserved_for_incident_review: unsafe,
      }));
      return;
    }
    await client.query(`
      UPDATE tanaghom.organization_agent_invocations invocation
         SET status='cancelled',
             result_summary=jsonb_build_object(
               'contract_version','phase7.agent-runtime-result.v1',
               'quarantined_by','phase7f_agent_studio_canary',
               'external_action_count',0
             ),
             finished_at=statement_timestamp()
       WHERE invocation.job_id IN (
         SELECT job.id FROM tanaghom.organization_agent_jobs job
          WHERE job.input->>'canary_id'=$1
       ) AND invocation.status IN (
         'waiting_approval','simulation_ready','ready','in_progress'
       )`,
    [canaryId]);
    await client.query(`
      UPDATE tanaghom.organization_agent_runs run
         SET status='cancelled',finished_at=statement_timestamp()
       WHERE run.job_id IN (
         SELECT job.id FROM tanaghom.organization_agent_jobs job
          WHERE job.input->>'canary_id'=$1
       ) AND run.status NOT IN (
         'succeeded','refused','failed','cancelled','indeterminate'
       )`,
    [canaryId]);
    const cancelled = await client.query(`
      UPDATE tanaghom.organization_agent_jobs
         SET status='cancelled',scenario_result='failed',
             error_code='phase7f_canary_quarantined',
             error_message='The controlled canary failed and was quarantined without an external action.',
             finished_at=statement_timestamp(),lease_token=NULL,
             lease_expires_at=NULL,updated_at=statement_timestamp()
       WHERE input->>'canary_id'=$1
         AND status IN ('queued','running','waiting_approval')`,
    [canaryId]);
    await client.query(`
      INSERT INTO tanaghom.organization_agent_runtime_events (
        organization_id,job_id,run_id,event_type,actor_kind,actor_ref,evidence
      )
      SELECT job.organization_id,job.id,run.id,'run_failed',
        'platform_operator','phase7f-canary-restore',
        jsonb_build_object(
          'error_code','phase7f_canary_quarantined',
          'canary_id',$1::text,
          'external_action_count',0
        )
      FROM tanaghom.organization_agent_jobs job
      LEFT JOIN LATERAL (
        SELECT candidate.id
        FROM tanaghom.organization_agent_runs candidate
        WHERE candidate.job_id=job.id
        ORDER BY candidate.started_at DESC,candidate.id
        LIMIT 1
      ) run ON true
      WHERE job.input->>'canary_id'=$1::text
        AND job.status='cancelled'
        AND job.error_code='phase7f_canary_quarantined'
        AND NOT EXISTS (
          SELECT 1
          FROM tanaghom.organization_agent_runtime_events event
          WHERE event.job_id=job.id
            AND event.event_type='run_failed'
            AND event.actor_ref='phase7f-canary-restore'
        )`,
    [canaryId]);
    await client.query("COMMIT");
    console.log(JSON.stringify({
      emergency_stop: true,
      reason_restored: true,
      jobs_quarantined: cancelled.rowCount,
      unfinished_canary_work_quarantined: true,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

try {
  if (action === "check-database") await checkDatabase();
  else if (action === "snapshot-controls") await snapshotControls();
  else if (action === "queue") await queue();
  else if (action === "assert-exclusive") await assertExclusive();
  else if (action === "unlock") await unlock();
  else if (action === "lock") await lock();
  else if (action === "finalize-next") await finalizeNext();
  else if (action === "verify") await verify();
  else await quarantine();
} finally {
  await client.end();
}
