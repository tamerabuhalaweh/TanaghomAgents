import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required; Phase 6 refuses to use DATABASE_URL.");

const root = process.cwd();
const evidencePath = process.env.PHASE6_AGENTIC_EVIDENCE_PATH
  || join(root, "tmp", "phase6-agentic-simulation-evidence.json");
const supportDirectory = join(dirname(evidencePath), "phase6-support");
const pinnedN8nImage = "docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd";

const workflowFiles = [
  "n8n/workflows/phase3/campaign-strategist.v1.json",
  "n8n/workflows/phase3/content-producer.v1.json",
  "n8n/workflows/phase4/postiz-draft-publisher.v1.json",
  "n8n/workflows/phase4/postiz-performance-monitor.v1.json",
  "n8n/workflows/phase5/ghl-contact-sync.v1.json",
  "n8n/workflows/phase5/governed-ghl-actions.v1.json",
  "n8n/workflows/phase5/conversation-intelligence.v1.json",
  "n8n/workflows/phase5g/quality-shadow-evaluator.v1.json",
];

const steps = [
  {
    key: "campaign_strategy_and_content",
    script: "scripts/n8n-workflow-integration.mjs",
    marker: "PASS: pinned n8n ran a sequential schedule-disabled core canary, stopped at human approval, produced no provider side effects, restored both workflows inactive, and retained retry coverage.",
  },
  {
    key: "approved_postiz_draft_and_performance",
    script: "scripts/n8n-postiz-workflow-integration.mjs",
    marker: "PASS: inactive Postiz workflows created one draft, normalized performance history, and blocked replay plus forged jobs.",
  },
  {
    key: "grounded_ghl_sales_lifecycle",
    script: "scripts/n8n-ghl-workflow-integration.mjs",
    marker: "PASS: inactive GHL workflows proved contact sync and the contiguous grounded inbound-to-opportunity lifecycle without credential exposure.",
    environment: {
      PHASE5_LIFECYCLE_EVIDENCE_PATH: join(supportDirectory, "phase5-sales-lifecycle-evidence.json"),
    },
  },
  {
    key: "quality_shadow_evaluation",
    script: "scripts/quality-shadow-workflow-integration.mjs",
    marker: "PASS: pinned n8n generated proposal-only evidence through simulated Gemma; no external action occurred.",
  },
  {
    key: "signed_inbound_and_replay",
    script: "scripts/ghl-inbound-gateway-integration.mjs",
    marker: "PASS: signed GHL ingress, durable acceptance, deduplication, pause gates, least-privilege claim, and load evidence verified.",
    environment: {
      GHL_INBOUND_LOAD_EVENTS: "250",
      GHL_INBOUND_EVIDENCE_PATH: join(supportDirectory, "ghl-inbound-evidence.json"),
    },
  },
  {
    key: "english_arabic_conversation_policy",
    script: "scripts/conversation-intelligence-evaluation.mjs",
    marker: "PASS:",
    environment: {
      CONVERSATION_EVALUATION_EVIDENCE_PATH: join(supportDirectory, "conversation-intelligence-evidence.json"),
    },
  },
  {
    key: "conversation_intelligence_worker",
    script: "scripts/conversation-intelligence-workflow-integration.mjs",
    marker: "PASS: inactive Conversation Intelligence used a dedicated inherited runtime login, processed grounded English and Arabic escalation scenarios, and failed malformed, contract-invalid, throttled, and overloaded model calls safely with zero external actions.",
  },
];

function runNode(script, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${script} failed (${code})\n${output.slice(-6000)}`));
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function workflowInventory() {
  const inventory = [];
  for (const path of workflowFiles) {
    const source = await readFile(join(root, path), "utf8");
    const workflow = JSON.parse(source);
    const schedules = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
    assert.equal(workflow.active, false, `${path} is unexpectedly active`);
    assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.webhook"), false,
      `${path} contains public webhook ingress`);
    if (!path.includes("phase3/")) {
      assert.ok(schedules.every((node) => node.disabled === true), `${path} has an enabled polling node`);
    }
    inventory.push({
      id: workflow.id,
      name: workflow.name,
      path,
      sha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
      active: workflow.active,
      schedules: schedules.map((node) => ({ name: node.name, disabled: node.disabled === true })),
      public_webhook_nodes: 0,
    });
  }
  assert.equal(inventory.length, 8);
  assert.equal(new Set(inventory.map((entry) => entry.id)).size, 8);
  return inventory;
}

await mkdir(supportDirectory, { recursive: true });
const inventory = await workflowInventory();
const stepEvidence = [];

try {
  for (const step of steps) {
    const started = Date.now();
    const output = await runNode(step.script, step.environment);
    if (step.key === "english_arabic_conversation_policy") {
      assert.match(output, /"language": "en"|"en": \{/);
      assert.match(output, /"language": "ar"|"ar": \{/);
    } else {
      assert.ok(output.includes(step.marker), `${step.key} did not emit its acceptance marker`);
    }
    stepEvidence.push({
      key: step.key,
      status: "passed",
      duration_ms: Date.now() - started,
      script: step.script,
      acceptance_marker: step.marker,
    });
  }

  const lifecycle = await readJson(join(supportDirectory, "phase5-sales-lifecycle-evidence.json"));
  const inbound = await readJson(join(supportDirectory, "ghl-inbound-evidence.json"));
  const intelligence = await readJson(join(supportDirectory, "conversation-intelligence-evidence.json"));
  assert.equal(lifecycle.boundaries.customer_credentials_used, false);
  assert.equal(lifecycle.boundaries.external_publish_or_message, false);
  assert.equal(lifecycle.final_state.provider_dispatch_count, 4);
  assert.equal(lifecycle.final_state.lead_status, "qualified");
  assert.ok(intelligence.by_language?.en, "English evaluation evidence is missing");
  assert.ok(intelligence.by_language?.ar, "Arabic evaluation evidence is missing");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: "phase6-agentic-evidence" });
  let databaseEvidence;
  try {
    const migration = await pool.query("SELECT version FROM public.schema_migrations ORDER BY applied_at DESC LIMIT 1");
    const phase3 = await pool.query(`SELECT job_type,status,count(*)::int AS count
      FROM tanaghom.agent_jobs WHERE job_type IN ('campaign.strategy.generate','campaign.content.generate')
      GROUP BY job_type,status ORDER BY job_type,status`);
    const content = await pool.query(`SELECT status,count(*)::int AS count FROM tanaghom.content_items
      WHERE draft_copy='Integration-only draft' GROUP BY status`);
    const quality = await pool.query(`SELECT count(*)::int AS results,
      coalesce(sum(external_action_count),0)::int AS external_actions
      FROM tanaghom.quality_shadow_results`);
    const audit = await pool.query("SELECT count(*)::int AS count FROM tanaghom.agent_actions_log");
    const unexpectedPersonalData = await pool.query(`SELECT count(*)::int AS count FROM tanaghom.app_users
      WHERE email !~* '(@example\\.test$|@tanaghom\\.test$)'`);
    assert.equal(migration.rows[0].version, "0024_conversation_intelligence_worker_registry");
    assert.equal(quality.rows[0].external_actions, 0);
    assert.equal(unexpectedPersonalData.rows[0].count, 0);
    databaseEvidence = {
      migration: migration.rows[0].version,
      phase3_jobs: phase3.rows,
      generated_content: content.rows,
      quality_shadow_results: quality.rows[0].results,
      quality_external_actions: quality.rows[0].external_actions,
      audit_records: audit.rows[0].count,
      unexpected_personal_data_records: unexpectedPersonalData.rows[0].count,
    };
  } finally {
    await pool.end();
  }

  const evidence = {
    contract_version: "phase6.agentic-simulation-evidence.v1",
    generated_at: new Date().toISOString(),
    scenario: "credential-independent-content-to-sales-acceptance",
    result: "passed",
    boundaries: {
      database: "single disposable PostgreSQL database",
      n8n_image: pinnedN8nImage,
      n8n_execution: "manual CLI execution of inactive exports",
      gemma: "local deterministic simulator",
      postiz: "local deterministic simulator",
      ghl: "local deterministic simulator",
      customer_credentials_used: false,
      production_contacted: false,
      real_leads_or_messages: false,
      advertising_spend: 0,
      smartlabs_contacted_or_modified: false,
    },
    narrative: [
      "Campaign strategy and review-only content generation",
      "Human-approved Postiz draft plus historical performance normalization",
      "Attributable lead and duplicate-safe GHL contact synchronization",
      "Signed inbound question, approved knowledge, grounded proposal, and supervised release",
      "Dedicated Conversation Intelligence worker with cited English output and Arabic escalation",
      "Human-approved reply, qualification, appointment, and opportunity operations",
      "English and Arabic policy evaluation",
      "Proposal-only quality shadow evidence with zero external actions",
    ],
    workflows: inventory,
    steps: stepEvidence,
    database: databaseEvidence,
    sales_lifecycle: {
      duplicate_delivery_count: lifecycle.inbound.duplicate_delivery_count,
      proposal_id: lifecycle.intelligence.proposal_id,
      cited_knowledge: lifecycle.intelligence.citation,
      supervisor_decisions: lifecycle.supervisor.decisions.length,
      approved_action_types: lifecycle.actions.map((action) => action.action_type),
      final_state: lifecycle.final_state,
    },
    inbound_gateway: {
      contract_version: inbound.contract_version,
      requested_load_events: 250,
      evidence: inbound,
    },
    language_evaluation: {
      contract_version: intelligence.contract_version,
      overall: intelligence.overall,
      english: intelligence.by_language.en,
      arabic: intelligence.by_language.ar,
    },
    limitations: [
      "Provider behavior is simulated; customer account permissions, quotas, and delivery semantics require staging acceptance.",
      "The gate proves backend and workflow behavior; authenticated browser, mobile, Arabic RTL, and customer UAT remain separate acceptance work.",
      "All n8n workflows remain inactive and no production activation is authorized by this evidence.",
    ],
  };

  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`PASS: Phase 6 executed all eight inactive workflows and the credential-independent content-to-sales narrative. Evidence: ${evidencePath}`);
} catch (error) {
  const failure = {
    contract_version: "phase6.agentic-simulation-evidence.v1",
    generated_at: new Date().toISOString(),
    scenario: "credential-independent-content-to-sales-acceptance",
    result: "failed",
    completed_steps: stepEvidence,
    error: String(error instanceof Error ? error.message : error).slice(0, 4000),
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  throw error;
}
