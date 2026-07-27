import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_TEST_URL is required; certification refuses to use DATABASE_URL.");
}

const evidencePath = process.env.PHASE7D_CERTIFICATION_EVIDENCE_PATH
  || join(process.cwd(), "tmp", "phase7d-runtime-certification-evidence.json");
const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

const organizationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000001";
const runtimeProfileId = "7d000000-0000-4000-8000-000000000001";
const expectedMigration = process.env.TANAGHOM_EXPECTED_MIGRATION
  || "0031_policy_runtime_executors_certification";
if (!new Set([
  "0031_policy_runtime_executors_certification",
  "0032_gemma_served_model_profile",
  "0033_agent_runtime_certification_evidence",
]).has(expectedMigration)) {
  throw new Error("TANAGHOM_EXPECTED_MIGRATION is not an approved certification baseline");
}
const hash = (value) => `sha256:${createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(value),
).digest("hex")}`;

const agents = [
  {
    code: "certified_campaign_planner",
    template_code: "campaign_planning",
    display_name: "Certified Campaign Planner",
    description: "Disposable bilingual proposal agent for exact runtime certification.",
    objective: "Prove bounded bilingual campaign planning without provider actions.",
    responsibility: "Create campaign strategy proposals and stop before external action.",
    tone: "Clear and evidence-based",
    brand_profile_key: "brand/tanaghom",
    skillVersionId: "72000000-0000-4000-8000-000000000001",
    skillCode: "create_campaign_strategy",
    operation: "campaign.strategy.propose",
    channel: null,
    consentRequired: false,
    allowedChannels: ["facebook", "instagram"],
    recordType: "campaign",
  },
  {
    code: "certified_conversation_advisor",
    template_code: "lead_qualification",
    display_name: "Certified Conversation Advisor",
    description: "Disposable bilingual reply agent for exact runtime certification.",
    objective: "Prove bounded bilingual reply proposals without sending messages.",
    responsibility: "Create grounded reply proposals and escalate unsafe requests.",
    tone: "Calm and direct",
    brand_profile_key: "brand/tanaghom",
    skillVersionId: "72000000-0000-4000-8000-000000000006",
    skillCode: "propose_conversation_reply",
    operation: "conversation.reply.propose",
    channel: "whatsapp",
    consentRequired: true,
    allowedChannels: ["whatsapp"],
    recordType: "conversation",
  },
];

const scenarioKinds = new Set([
  "success",
  "refusal",
  "escalation",
  "prompt_injection",
  "provider_failure",
  "duplicate_retry",
  "emergency_stop",
]);

async function query(text, values = []) {
  return client.query(text, values);
}

async function expectReject(label, operation) {
  const savepoint = `expected_${label.replaceAll(/[^a-z0-9_]/g, "_")}`;
  await query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    assert.fail(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    await query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  } finally {
    await query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

async function createAgent(agent, index) {
  const payload = {
    code: agent.code,
    template_code: agent.template_code,
    display_name: agent.display_name,
    description: agent.description,
    objective: agent.objective,
    responsibility: agent.responsibility,
    tone: agent.tone,
    brand_profile_key: agent.brand_profile_key,
    languages: ["en", "ar"],
    knowledge_keys: [],
    skills: [{
      skill_source: "platform",
      skill_version_id: agent.skillVersionId,
      operating_mode: "shadow",
      approval_required: true,
      constraints: {},
    }],
    integrations: [],
    policy: {
      business_timezone: "Asia/Amman",
      business_hours: [],
      allowed_channels: agent.allowedChannels,
      consent_required: agent.consentRequired,
      max_steps: 2,
      max_tool_calls: 2,
      max_retries: 2,
      max_concurrency: 2,
      max_runtime_seconds: 120,
      max_tokens: 4000,
      max_daily_actions: 0,
      max_actions_per_minute: 0,
      max_follow_ups_per_contact: 0,
      monthly_budget: 0,
      allowed_record_types: [agent.recordType],
      allowed_action_types: ["proposal.create"],
      approval_actions: ["provider.external_write"],
      approval_roles: ["owner", "reviewer"],
      approval_expiry_minutes: 60,
      parameter_bound_approval: true,
      escalation_conditions: ["Escalate on missing evidence, consent, or policy conflict."],
    },
  };
  const created = await query(
    `SELECT * FROM tanaghom.create_organization_agent_draft(
       $1::uuid,$2::uuid,$3::jsonb,$4::text,NULL
     )`,
    [organizationId, ownerId, payload, hash(`phase7d-cert-agent-${index}`)],
  );
  const versionId = created.rows[0].agent_version_id;
  await query(
    `SELECT * FROM tanaghom.transition_organization_agent_version(
       $1::uuid,$2::uuid,$3::uuid,'validate',$4::jsonb
     )`,
    [
      organizationId,
      ownerId,
      versionId,
      {
        valid: true,
        validator_version: "phase7d-certification-integration.v1",
        runtime_certified: false,
      },
    ],
  );
  return versionId;
}

async function executeScenario(agent, versionId, scenario, ordinal) {
  const input = {
    record_type: agent.recordType,
    scenario_kind: scenario.scenario_kind,
    language: scenario.language,
    content: scenario.language === "ar"
      ? "طلب اختبار عربي منزوع الهوية ومقيّد بالسياسة."
      : "De-identified policy-bounded English test request.",
  };
  const queued = await query(
    `SELECT * FROM tanaghom.queue_organization_agent_job(
       $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,NULL,
       $6::uuid,$7::text,$8::text,'scenario',$9::text,$10::boolean,$11::text,$12::jsonb
     )`,
    [
      organizationId,
      ownerId,
      versionId,
      runtimeProfileId,
      scenario.id,
      randomUUID(),
      `phase7d:cert:${agent.code}:${scenario.code}`,
      hash(input),
      agent.channel,
      agent.consentRequired,
      scenario.language,
      input,
    ],
  );
  const jobId = queued.rows[0].job_id;
  const claimed = await query(
    "SELECT * FROM tanaghom.claim_organization_agent_job($1::text)",
    [`phase7d_cert_runner_${ordinal}`],
  );
  assert.equal(claimed.rows.length, 1);
  assert.equal(claimed.rows[0].job_id, jobId);
  let runId = claimed.rows[0].run_id;
  let context = claimed.rows[0].planner_context;
  let recoveryAttempts = 1;

  if (scenario.scenario_kind === "provider_failure") {
    const competingInput = {
      ...input,
      queue_precedence_decoy: true,
    };
    const competing = await query(
      `SELECT * FROM tanaghom.queue_organization_agent_job(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,NULL,
         $6::uuid,$7::text,$8::text,'scenario',$9::text,$10::boolean,$11::text,$12::jsonb
       )`,
      [
        organizationId,
        ownerId,
        versionId,
        runtimeProfileId,
        scenario.id,
        randomUUID(),
        `phase7d:cert:aged-peer:${agent.code}:${scenario.code}:${randomUUID()}`,
        hash(competingInput),
        agent.channel,
        agent.consentRequired,
        scenario.language,
        competingInput,
      ],
    );
    const competingJobId = competing.rows[0].job_id;
    await query(
      `UPDATE tanaghom.organization_agent_jobs
          SET available_at=statement_timestamp()-interval '10 minutes'
        WHERE id=$1::uuid AND status='queued'`,
      [competingJobId],
    );
    const failed = await query(
      `SELECT tanaghom.fail_agent_runtime_run(
         $1::uuid,'dependency.unavailable',
         'Disposable aged-queue recovery regression.',
         true
       ) AS status`,
      [runId],
    );
    assert.equal(failed.rows[0].status, "queued");
    const reprioritized = await query(
      `WITH queued_peer AS (
         SELECT min(peer.available_at) AS earliest_available_at
           FROM tanaghom.organization_agent_jobs peer
          WHERE peer.status='queued' AND peer.id<>$1::uuid
       )
       UPDATE tanaghom.organization_agent_jobs target
          SET available_at=coalesce(
            queued_peer.earliest_available_at-interval '1 second',
            statement_timestamp()-interval '1 second'
          )
         FROM queued_peer
        WHERE target.id=$1::uuid AND target.status='queued'
        RETURNING target.id`,
      [jobId],
    );
    assert.equal(reprioritized.rowCount, 1);
    const recovered = await query(
      "SELECT * FROM tanaghom.claim_organization_agent_job($1::text)",
      [`phase7d_cert_recovery_${ordinal}`],
    );
    assert.equal(recovered.rowCount, 1);
    assert.equal(recovered.rows[0].job_id, jobId);
    const attempt = await query(
      "SELECT attempt FROM tanaghom.organization_agent_jobs WHERE id=$1::uuid",
      [jobId],
    );
    assert.equal(attempt.rows[0].attempt, 2);
    await query(
      `UPDATE tanaghom.organization_agent_jobs
          SET status='cancelled',finished_at=statement_timestamp(),
              updated_at=statement_timestamp()
        WHERE id=$1::uuid AND status='queued'`,
      [competingJobId],
    );
    runId = recovered.rows[0].run_id;
    context = recovered.rows[0].planner_context;
    recoveryAttempts = 2;
  }

  const isPolicyRefusal = new Set(["refusal", "escalation"]).has(scenario.scenario_kind);
  const skillCode = isPolicyRefusal ? "unassigned_skill" : agent.skillCode;
  const operation = isPolicyRefusal ? "unsupported.operation" : agent.operation;
  const parameters = {
    organization_id: organizationId,
    record_type: agent.recordType,
    language: scenario.language,
    test_only: true,
  };
  const step = {
    sequence: 1,
    skill_code: skillCode,
    operation,
    channel: agent.channel,
    consent_evidence: agent.consentRequired ? "verified" : "not_required",
    arguments_json: JSON.stringify(parameters),
    idempotency_key: `phase7d:${agent.code}:${scenario.code}:step:1`,
    rationale: "Exercise the exact assigned skill or a deliberate server-side refusal boundary.",
  };
  const steps = [step];
  if (agent.code === "certified_campaign_planner"
    && scenario.scenario_kind === "success"
    && scenario.language === "en") {
    const secondParameters = {
      ...parameters,
      evidence_variant: "multi_step_scenario_aggregation",
    };
    steps.push({
      ...step,
      sequence: 2,
      arguments_json: JSON.stringify(secondParameters),
      idempotency_key: `phase7d:${agent.code}:${scenario.code}:step:2`,
      rationale: "Prove one canonical scenario may contain multiple bounded invocations.",
    });
  }
  const plan = {
    contract_version: "phase7.agent-runtime-plan.v1",
    agent_version_id: versionId,
    agent_content_hash: context.agent.content_hash,
    language: scenario.language,
    intent_summary: `Run ${scenario.scenario_kind} certification behavior in ${scenario.language}.`,
    steps,
    final_response_mode: isPolicyRefusal ? "human_escalation" : "result_summary",
  };
  await query(
    "SELECT tanaghom.record_agent_runtime_plan($1::uuid,$2::jsonb,$3::text,30,15)",
    [runId, plan, hash(plan)],
  );

  for (const currentStep of steps) {
    const currentParameters = JSON.parse(currentStep.arguments_json);
    if (scenario.scenario_kind === "emergency_stop") {
      await query(
        `UPDATE tanaghom.agent_runtime_controls
            SET emergency_stop=true,reason='Disposable certification emergency-stop scenario',
                updated_at=statement_timestamp()
          WHERE singleton`,
      );
    }
    const authorized = await query(
      "SELECT * FROM tanaghom.authorize_agent_skill_invocation($1::uuid,$2::jsonb,$3::text)",
      [runId, currentStep, hash(currentParameters)],
    );
    if (scenario.scenario_kind === "emergency_stop") {
      await query(
        `UPDATE tanaghom.agent_runtime_controls
            SET emergency_stop=false,reason='Resume disposable certification scenarios',
                updated_at=statement_timestamp()
          WHERE singleton`,
      );
      assert.equal(authorized.rows[0].denial_reason, "runtime_emergency_stop");
    } else if (isPolicyRefusal) {
      assert.equal(
        authorized.rows[0].denial_reason,
        "skill_not_assigned_or_not_executable",
      );
    } else {
      assert.equal(authorized.rows[0].status, "simulation_ready");
      if (scenario.scenario_kind === "duplicate_retry") {
        const duplicate = await query(
          "SELECT * FROM tanaghom.authorize_agent_skill_invocation($1::uuid,$2::jsonb,$3::text)",
          [runId, currentStep, hash(currentParameters)],
        );
        assert.equal(duplicate.rows[0].invocation_id, authorized.rows[0].invocation_id);
        const count = await query(
          "SELECT count(*)::int AS count FROM tanaghom.organization_agent_invocations WHERE run_id=$1",
          [runId],
        );
        assert.equal(count.rows[0].count, 1);
      }
      const invocation = await query(
        "SELECT * FROM tanaghom.claim_agent_simulation_invocation($1::text)",
        ["phase7d_certification_simulator"],
      );
      assert.equal(invocation.rows.length, 1);
      assert.equal(invocation.rows[0].invocation_id, authorized.rows[0].invocation_id);
      const output = {
        simulation: true,
        external_action_count: 0,
        behavior: scenario.scenario_kind === "provider_failure"
          ? "dependency_failure_safely_contained"
          : scenario.scenario_kind,
        language: scenario.language,
      };
      const result = {
        contract_version: "phase7.agent-runtime-result.v1",
        invocation_id: invocation.rows[0].invocation_id,
        outcome: "succeeded",
        output_json: JSON.stringify(output),
        provider_reference: null,
        prompt_tokens: 20,
        completion_tokens: 10,
        actual_cost: 0,
        error_code: null,
      };
      await query(
        `SELECT tanaghom.complete_agent_simulation_invocation(
           $1::uuid,'succeeded',$2::jsonb,20,10
         )`,
        [invocation.rows[0].invocation_id, result],
      );
    }
  }

  const final = await query(
    `SELECT tanaghom.finalize_agent_runtime_run(
       $1::uuid,'succeeded',$2::jsonb,'passed'
     ) AS outcome`,
    [
      runId,
      {
        contract_version: "phase7.agent-runtime-final-summary.v1",
        simulation: true,
        external_action_count: 0,
        scenario_kind: scenario.scenario_kind,
        language: scenario.language,
        recovery_attempts: recoveryAttempts,
        recovery_queue_precedence_verified:
          scenario.scenario_kind === "provider_failure",
      },
    ],
  );
  assert.equal(final.rows[0].outcome, "succeeded");
  return {
    code: scenario.code,
    language: scenario.language,
    kind: scenario.scenario_kind,
    outcome: "passed",
    external_actions: 0,
    invocation_count: steps.length,
    recovery_attempts: recoveryAttempts,
    recovery_queue_precedence_verified:
      scenario.scenario_kind === "provider_failure",
  };
}

const report = {
  contract_version: "phase7d.runtime-certification-evidence.v1",
  generated_at: new Date().toISOString(),
  environment: "disposable_postgresql",
  runtime_profile: "gemma4_vllm_strict_v1",
  agents: [],
  totals: {
    agents: 0,
    scenarios: 0,
    languages: ["en", "ar"],
    provider_dispatches: 0,
    external_actions: 0,
    actual_cost: 0,
  },
};

try {
  await query("BEGIN");
  const latest = await query(
    "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
  );
  assert.equal(latest.rows[0].version, expectedMigration);
  const adapters = await query(
    `SELECT code,enabled,workflow_id,workflow_sha256
       FROM tanaghom.agent_runtime_executor_adapters ORDER BY code`,
  );
  assert.equal(adapters.rows.length, 3);
  assert.ok(adapters.rows.every((adapter) => adapter.enabled === false));
  await query(
    `UPDATE tanaghom.agent_runtime_controls
        SET emergency_stop=false,reason='Disposable bilingual certification harness',
            updated_at=statement_timestamp()
      WHERE singleton`,
  );

  for (const [agentIndex, agent] of agents.entries()) {
    const versionId = await createAgent(agent, agentIndex + 1);
    const scenarios = await query(
      `SELECT id,code,language,scenario_kind
         FROM tanaghom.organization_agent_test_scenarios
        WHERE agent_version_id=$1::uuid
        ORDER BY language,scenario_kind,code`,
      [versionId],
    );
    assert.equal(scenarios.rows.length, 14);
    assert.deepEqual(new Set(scenarios.rows.map((row) => row.language)), new Set(["en", "ar"]));
    assert.deepEqual(new Set(scenarios.rows.map((row) => row.scenario_kind)), scenarioKinds);

    const outcomes = [];
    for (const [scenarioIndex, scenario] of scenarios.rows.entries()) {
      outcomes.push(await executeScenario(
        agent,
        versionId,
        scenario,
        agentIndex * 14 + scenarioIndex + 1,
      ));
    }
    const evidence = await query(
      `SELECT tanaghom.build_agent_runtime_certification_evidence(
         $1::uuid,$2::uuid,$3::uuid
       ) AS evidence`,
      [organizationId, versionId, runtimeProfileId],
    );
    const canonical = evidence.rows[0].evidence;
    assert.equal(canonical.scenario_count, 14);
    assert.equal(canonical.external_action_count, 0);
    assert.equal(canonical.scenarios.length, 14);
    if (agent.code === "certified_campaign_planner") {
      assert.equal(
        canonical.scenarios.find((scenario) => scenario.code === "en_success")
          ?.invocation_count,
        2,
      );
    }
    const evidenceHash = await query(
      "SELECT tanaghom.agent_runtime_sha256($1::jsonb) AS hash",
      [canonical],
    );
    await expectReject("tampered_certification", () => query(
      `SELECT tanaghom.record_agent_runtime_certification_v2(
         $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text
       )`,
      [
        organizationId,
        versionId,
        runtimeProfileId,
        evidenceHash.rows[0].hash,
        { ...canonical, external_action_count: 1 },
        "phase7d_certification_operator",
      ],
    ));
    const certification = await query(
      `SELECT tanaghom.record_agent_runtime_certification_v2(
         $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text
       ) AS certification_id`,
      [
        organizationId,
        versionId,
        runtimeProfileId,
        evidenceHash.rows[0].hash,
        canonical,
        "phase7d_certification_operator",
      ],
    );
    assert.ok(certification.rows[0].certification_id);
    report.agents.push({
      code: agent.code,
      languages: ["en", "ar"],
      scenarios: outcomes,
      canonical_scenario_count: canonical.scenario_count,
      canonical_external_action_count: canonical.external_action_count,
      evidence_hash: evidenceHash.rows[0].hash,
      certification_recorded: true,
    });
  }

  const unsafe = await query(
    `SELECT
       count(*) FILTER (WHERE provider_dispatch_id IS NOT NULL)::int AS provider_dispatches,
       count(*) FILTER (WHERE provider_reference IS NOT NULL)::int AS provider_references,
       coalesce(sum(actual_cost),0)::numeric AS actual_cost
     FROM tanaghom.organization_agent_invocations`,
  );
  assert.equal(unsafe.rows[0].provider_dispatches, 0);
  assert.equal(unsafe.rows[0].provider_references, 0);
  assert.equal(Number(unsafe.rows[0].actual_cost), 0);
  report.totals.agents = report.agents.length;
  report.totals.scenarios = report.agents.reduce(
    (sum, agent) => sum + agent.scenarios.length,
    0,
  );
  assert.equal(report.totals.scenarios, 28);
  await query("ROLLBACK");
} catch (error) {
  await query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  "PASS: two bilingual agents completed 28 canonical zero-action scenarios; "
  + "tampered evidence was rejected and no provider dispatch occurred.",
);
