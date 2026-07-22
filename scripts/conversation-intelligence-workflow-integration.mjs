import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");
const image = "docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd";
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-conversation-workflow-"));
const volume = `tanaghom-conversation-workflow-${process.pid}`;
const modelPort = 43208;
const containerHost = process.env.N8N_TEST_HOST || (process.platform === "win32" ? "host.docker.internal" : "127.0.0.1");
const bindHost = process.platform === "win32" ? "0.0.0.0" : "127.0.0.1";
const organizationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000001";
const runtimeRole = "tanaghom_conversation_runtime";
let modelCalls = 0;
let cleanupFailure;
let runtimeRoleCreated = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code})\n${output}`)));
  });
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function hasSchemaKeyword(value, wanted) {
  if (Array.isArray(value)) return value.some((entry) => hasSchemaKeyword(entry, wanted));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => key === wanted || hasSchemaKeyword(entry, wanted));
}

const modelServer = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end(); return;
  }
  assert.equal(request.headers.authorization, "Bearer integration-only-gemma-token");
  const payload = await jsonBody(request);
  assert.equal(payload.model, "gemma4-26b-a4b-canary");
  assert.equal(payload.response_format?.type, "json_schema");
  assert.equal(payload.response_format?.json_schema?.strict, true);
  assert.equal(hasSchemaKeyword(payload.response_format?.json_schema?.schema, "uniqueItems"), false,
    "Gemma grammar request retained unsupported uniqueItems");
  assert.match(payload.messages?.[0]?.content ?? "", /untrusted customer data/i);
  const intelligence = JSON.parse(payload.messages?.[1]?.content ?? "{}");
  assert.equal(intelligence.contract_version, "phase5.conversation-intelligence-request.v1");
  assert.equal(intelligence.system_policy.external_actions_allowed, false);
  assert.deepEqual(intelligence.tool_results, []);
  modelCalls += 1;
  const message = intelligence.provider_message.body;
  if (message === "MALFORMED") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }));
    return;
  }
  if (message === "RATE LIMIT") {
    response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "90" });
    response.end(JSON.stringify({ error: { message: "Synthetic model throttle" } }));
    return;
  }
  if (message === "OVERLOADED") {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Synthetic model overload" } }));
    return;
  }
  if (message === "CONTRACT MISMATCH") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      classification: { intent: "pricing_inquiry", confidence: 0.99, risk_category: "none", requires_escalation: false },
      proposal: {
        language: "en", message: "Invented price",
        citations: [{
          source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          source_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          fact_description: "Unapproved invented source",
        }],
        no_approved_answer: false,
      },
      summary_update: {
        new_summary: "Attempted unapproved citation.", event_ids: [intelligence.provider_message.event_id],
        sales_stage: "inquiry", customer_needs: [], unresolved_questions: [], language: "en",
      },
      external_action_count: 0,
      contract_version: "phase5.conversation-intelligence-output.v1",
      prompt_version: "phase5.conversation-intelligence.prompt.v1",
    }) } }] }));
    return;
  }
  const eventId = intelligence.provider_message.event_id;
  let output;
  if (message.includes("السعر")) {
    output = {
      contract_version: "phase5.conversation-intelligence-output.v1",
      prompt_version: "phase5.conversation-intelligence.prompt.v1",
      model_name: "gemma4-26b-a4b-canary",
      language: "ar", intent: "pricing", urgency: "normal", sentiment: "neutral",
      sales_stage: "consideration", risk_categories: [], next_best_action: "escalate_to_human",
      confidence: 0.55, answer_status: "no_approved_answer", proposed_reply: null, citations: [],
      escalation: { required: true, category: "no_approved_knowledge", reason: "لا توجد إجابة عربية معتمدة." },
      conversation_summary: { language: "ar", summary: "سأل العميل عن السعر.", input_event_ids: [eventId] },
      external_action_count: 0,
    };
  } else {
    const source = intelligence.retrieved_knowledge.find((entry) => entry.source_key === "workflow_growth_plan");
    assert.ok(source, "approved English knowledge was not retrieved");
    output = {
      classification: { intent: "pricing_inquiry", confidence: 0.96, risk_category: "none", requires_escalation: false },
      proposal: {
        language: "en", message: "The approved Growth plan is USD 99 per month.",
        citations: [{ source_id: source.source_id, source_version_id: source.source_version_id, fact_description: "Approved Growth plan price" }],
        no_approved_answer: false,
      },
      summary_update: {
        new_summary: "Lead asked for the approved Growth plan price.", event_ids: [eventId],
        sales_stage: "inquiry", customer_needs: ["pricing_information"], unresolved_questions: [], language: "en",
      },
      external_action_count: 0,
      contract_version: "phase5.conversation-intelligence-output.v1",
      prompt_version: "phase5.conversation-intelligence.prompt.v1",
    };
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
try {
  modelServer.listen(modelPort, bindHost); await once(modelServer, "listening");
  await pool.query(`CREATE ROLE ${runtimeRole}
    LOGIN PASSWORD 'integration-only'
    NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
    IN ROLE tanaghom_conversation_worker`);
  runtimeRoleCreated = true;
  const runtimeBoundary = (await pool.query(`SELECT
      pg_has_role($1, 'tanaghom_conversation_worker', 'MEMBER') AS conversation_member,
      pg_has_role($1, 'tanaghom_n8n_worker', 'MEMBER') AS general_worker_member,
      has_table_privilege($1, 'tanaghom.conversation_intelligence_proposals', 'SELECT,INSERT,UPDATE,DELETE') AS proposal_table_access,
      has_function_privilege($1, 'tanaghom.claim_ghl_inbound_event_job()', 'EXECUTE') AS can_claim,
      has_function_privilege($1, 'tanaghom.prepare_conversation_intelligence(uuid)', 'EXECUTE') AS can_prepare,
      has_function_privilege($1, 'tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb)', 'EXECUTE') AS can_persist,
      has_function_privilege($1, 'tanaghom.record_ghl_inbound_event_failure(uuid,text,text,integer)', 'EXECUTE') AS can_fail`,
    [runtimeRole])).rows[0];
  assert.deepEqual(runtimeBoundary, {
    conversation_member: true, general_worker_member: false, proposal_table_access: false,
    can_claim: true, can_prepare: true, can_persist: true, can_fail: true,
  });
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,reason='Disposable conversation workflow test' WHERE provider='ghl'");
  await pool.query(`INSERT INTO tanaghom.integration_connections
    (organization_id,provider,status,base_url,credential_kind,credential_ciphertext,credential_nonce,
     credential_auth_tag,credential_key_version,secret_last_four,configuration,configured_by,last_tested_at,last_test_status)
    VALUES ($1,'ghl','connected','https://services.leadconnectorhq.com','private_token',decode('01','hex'),
      decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test','{"location_id":"location-test-1"}',
      $2,now(),'passed')
    ON CONFLICT (organization_id,provider) DO UPDATE SET
      status='connected',
      base_url=EXCLUDED.base_url,
      credential_kind=EXCLUDED.credential_kind,
      credential_ciphertext=EXCLUDED.credential_ciphertext,
      credential_nonce=EXCLUDED.credential_nonce,
      credential_auth_tag=EXCLUDED.credential_auth_tag,
      credential_key_version=EXCLUDED.credential_key_version,
      secret_last_four=EXCLUDED.secret_last_four,
      configuration=EXCLUDED.configuration,
      configured_by=EXCLUDED.configured_by,
      last_tested_at=EXCLUDED.last_tested_at,
      last_test_status=EXCLUDED.last_test_status`,
  [organizationId, ownerId]);
  await pool.query(`UPDATE tanaghom.organization_crm_policies SET
      conversation_processing_mode='shadow',conversation_emergency_stop=false,
      conversation_emergency_reason='Disposable proposal-only workflow gate'
    WHERE organization_id=$1`, [organizationId]);
  // The Phase 6 suite runs the gateway load scenario against this same disposable
  // database first. Retire only its unclaimed synthetic backlog so this worker
  // proof can deterministically assert the events it creates below.
  await pool.query(`WITH retired AS (
      UPDATE tanaghom.agent_jobs SET
        status='cancelled',finished_at=statement_timestamp(),
        error_code='disposable_fixture_replaced',
        error_message='Retired before the Conversation Intelligence worker scenario'
      WHERE job_type='conversation.ghl.inbound_event' AND status='queued'
      RETURNING (input->>'event_id')::uuid AS event_id
    )
    UPDATE tanaghom.ghl_inbound_events event SET
      status='dead_letter',processed_at=statement_timestamp(),
      last_error_code='disposable_fixture_replaced',
      last_error_message='Retired before the Conversation Intelligence worker scenario'
    FROM retired WHERE event.id=retired.event_id AND event.status='pending'`);
  const knowledge = (await pool.query(
    `SELECT * FROM tanaghom.create_sales_knowledge_draft(
      'workflow_growth_plan','Workflow Growth plan facts','pricing','en',
      'The approved Growth plan price is USD 99 per month.',
      '[{"fact":"growth_plan_monthly_price","value":99,"currency":"USD"}]'::jsonb,
      'customer_entry','disposable-conversation-workflow',$1)`, [ownerId])).rows[0];
  for (const action of ["review", "approve", "activate"]) {
    await pool.query("SELECT * FROM tanaghom.transition_sales_knowledge_version($1,$2,$3,NULL)",
      [knowledge.version_id, action, ownerId]);
  }

  const database = new URL(databaseUrl);
  const credentials = [
    { id: "62000000-0000-4000-8000-000000000005", name: "Tanaghom Conversation PostgreSQL", type: "postgres", data: {
      host: containerHost, database: database.pathname.slice(1), user: runtimeRole,
      password: "integration-only", port: Number(database.port || 5432), ssl: "disable",
    } },
    { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API", type: "httpHeaderAuth",
      data: { name: "Authorization", value: "Bearer integration-only-gemma-token" } },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  const workflow = JSON.parse(await readFile(join(root, "n8n", "workflows", "phase5", "conversation-intelligence.v1.json"), "utf8"));
  workflow.nodes.find((entry) => entry.name === "Call Gemma").parameters.url = `http://${containerHost}:${modelPort}/v1/chat/completions`;
  await writeFile(join(temporary, "workflow.json"), JSON.stringify(workflow));
  await chmod(temporary, 0o755); await chmod(join(temporary, "credentials.json"), 0o644); await chmod(join(temporary, "workflow.json"), 0o644);
  await run("docker", ["volume", "create", volume]);
  const dockerBase = ["run", "--rm", "--network", "host",
    "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32",
    "-e", "N8N_USER_MANAGEMENT_DISABLED=true", "-e", "N8N_DIAGNOSTICS_ENABLED=false",
    "-e", "N8N_SSRF_PROTECTION_ENABLED=false",
    "-v", `${volume}:/home/node/.n8n`, "-v", `${temporary}:/fixtures:ro`, image];
  await run("docker", [...dockerBase, "import:credentials", "--input=/fixtures/credentials.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/workflow.json"]);

  async function accept(providerEventId, conversationId, body) {
    const event = {
      contract_version: "phase5.ghl-inbound-event.v1", provider_event_id: providerEventId,
      provider_event_type: "InboundMessage", location_id: "location-test-1",
      contact_id: `contact-${providerEventId}`, conversation_id: conversationId,
      message_id: `message-${providerEventId}`, channel: "whatsapp", direction: "inbound",
      occurred_at: new Date().toISOString(), details: { body },
    };
    const hash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    return (await pool.query("SELECT * FROM tanaghom.accept_ghl_inbound_event($1::jsonb,$2)", [JSON.stringify(event), hash])).rows[0];
  }
  async function execute() {
    return run("docker", [...dockerBase, "execute", "--id=phase5ConversationIntelligenceV1", "--rawOutput"]);
  }

  const english = await accept("workflow-english-1", "workflow-conversation-en", "What is the Growth plan price?");
  const duplicate = await accept("workflow-english-1", "workflow-conversation-en", "What is the Growth plan price?");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event_id, english.event_id);
  await execute();
  const englishProposal = (await pool.query("SELECT * FROM tanaghom.conversation_intelligence_proposals WHERE event_id=$1", [english.event_id])).rows[0];
  assert.equal(englishProposal.language, "en");
  assert.equal(englishProposal.answer_status, "proposal");
  assert.equal(englishProposal.external_action_count, 0);
  assert.equal(englishProposal.citations.length, 1);

  const arabic = await accept("workflow-arabic-1", "workflow-conversation-ar", "ما هو السعر؟");
  await execute();
  const arabicProposal = (await pool.query("SELECT * FROM tanaghom.conversation_intelligence_proposals WHERE event_id=$1", [arabic.event_id])).rows[0];
  assert.equal(arabicProposal.language, "ar");
  assert.equal(arabicProposal.answer_status, "no_approved_answer");
  assert.equal(arabicProposal.escalation_required, true);
  assert.equal(arabicProposal.external_action_count, 0);

  const malformed = await accept("workflow-malformed-1", "workflow-conversation-malformed", "MALFORMED");
  await execute();
  const malformedState = (await pool.query(`SELECT job.status,job.attempt,job.error_code,
      (SELECT count(*)::int FROM tanaghom.conversation_intelligence_proposals proposal WHERE proposal.event_id=$1) proposals
    FROM tanaghom.agent_jobs job WHERE job.input->>'event_id'=$1::text`, [malformed.event_id])).rows[0];
  assert.deepEqual(malformedState, { status: "queued", attempt: 1, error_code: "gemma_invalid_json", proposals: 0 });

  const throttled = await accept("workflow-throttle-1", "workflow-conversation-throttle", "RATE LIMIT");
  await execute();
  const throttleState = (await pool.query(`SELECT job.status,job.attempt,job.error_code,
      (SELECT count(*)::int FROM tanaghom.conversation_intelligence_proposals proposal WHERE proposal.event_id=$1) proposals
    FROM tanaghom.agent_jobs job WHERE job.input->>'event_id'=$1::text`, [throttled.event_id])).rows[0];
  assert.deepEqual(throttleState, { status: "queued", attempt: 1, error_code: "gemma_rate_limited", proposals: 0 });
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.conversation_dependency_cooldowns WHERE organization_id=$1 AND dependency='gemma' AND blocked_until>now()", [organizationId])).rows[0].count, 1);

  await pool.query("DELETE FROM tanaghom.conversation_dependency_cooldowns WHERE organization_id=$1 AND dependency='gemma'", [organizationId]);
  const mismatched = await accept("workflow-contract-mismatch-1", "workflow-conversation-contract", "CONTRACT MISMATCH");
  await execute();
  const mismatchState = (await pool.query(`SELECT job.status,job.attempt,job.error_code,
      (SELECT count(*)::int FROM tanaghom.conversation_intelligence_proposals proposal WHERE proposal.event_id=$1) proposals
    FROM tanaghom.agent_jobs job WHERE job.input->>'event_id'=$1::text`, [mismatched.event_id])).rows[0];
  assert.deepEqual(mismatchState, { status: "queued", attempt: 1, error_code: "gemma_contract_mismatch", proposals: 0 });

  const unavailable = await accept("workflow-overloaded-1", "workflow-conversation-overloaded", "OVERLOADED");
  await execute();
  const unavailableState = (await pool.query(`SELECT job.status,job.attempt,job.error_code,
      (SELECT count(*)::int FROM tanaghom.conversation_intelligence_proposals proposal WHERE proposal.event_id=$1) proposals
    FROM tanaghom.agent_jobs job WHERE job.input->>'event_id'=$1::text`, [unavailable.event_id])).rows[0];
  assert.deepEqual(unavailableState, { status: "queued", attempt: 1, error_code: "gemma_overloaded", proposals: 0 });

  assert.equal(modelCalls, 6);
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.external_operations")).rows[0].count, 0);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find((entry) => entry.type === "n8n-nodes-base.scheduleTrigger").disabled, true);
  assert.ok(workflow.nodes.every((entry) => !["n8n-nodes-base.webhook", "n8n-nodes-base.executeCommand", "n8n-nodes-base.readWriteFile", "n8n-nodes-base.ssh"].includes(entry.type)));
  console.log("PASS: inactive Conversation Intelligence used a dedicated inherited runtime login, processed grounded English and Arabic escalation scenarios, and failed malformed, contract-invalid, throttled, and overloaded model calls safely with zero external actions.");
} finally {
  modelServer.close();
  if (runtimeRoleCreated) {
    await pool.query(`DROP ROLE ${runtimeRole}`).catch((error) => { cleanupFailure ||= error; });
  }
  await pool.end().catch((error) => { cleanupFailure ||= error; });
  await run("docker", ["volume", "rm", "-f", volume]).catch((error) => { cleanupFailure ||= error; });
  await rm(temporary, { recursive: true, force: true }).catch((error) => { cleanupFailure ||= error; });
  if (cleanupFailure) throw cleanupFailure;
}
