import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");
const image = "docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd";
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-ghl-n8n-"));
const volume = `tanaghom-ghl-n8n-test-${process.pid}`;
const gatewayPort = 43203;
const containerHost = process.env.N8N_TEST_HOST || (process.platform === "win32" ? "host.docker.internal" : "127.0.0.1");
const gatewayBindHost = process.platform === "win32" ? "0.0.0.0" : "127.0.0.1";
const leadId = "65000000-0000-4000-8000-000000000011";
let contactRequestCount = 0;
let actionRequestCount = 0;
const actionConversationId = "65000000-0000-4000-8000-000000000021";
const lifecycleLeadId = "65000000-0000-4000-8000-000000000031";
const lifecycleServiceUserId = "65000000-0000-4000-8000-000000000032";
const lifecycleProviderConversationId = "ghl-lifecycle-conversation-1";
const lifecycleContactId = "ghl-lifecycle-contact-1";
const lifecycleEvidencePath = process.env.PHASE5_LIFECYCLE_EVIDENCE_PATH || join(root, "tmp", "phase5-sales-lifecycle-evidence.json");
const lifecycleDispatches = [];
let cleanupFailure;

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

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(404).end(); return;
  }
  const body = await requestBody(request);
  assert.equal(request.headers.authorization, "Bearer integration-only-worker-token-32");
  if (request.url === "/api/internal/integrations/ghl/contact") {
    contactRequestCount += 1;
    assert.equal(request.headers["idempotency-key"], `ghl-contact-upsert:${leadId}:1`);
    assert.deepEqual(body.request_body, {
      name: "GHL Workflow Lead", email: "workflow-lead@example.test", phone: "+15555550111",
      locationId: "location-test-1", source: "Tanaghom", createNewIfDuplicateAllowed: false,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ new: true, contact: { id: "ghl-contact-123", locationId: "location-test-1" } }));
    return;
  }
  if (request.url === "/api/internal/integrations/ghl/action") {
    actionRequestCount += 1;
    const key = request.headers["idempotency-key"];
    const dispatch = body.request_body;
    assert.equal(dispatch.contract_version, "phase5.ghl-action-dispatch.v1");
    if (key === "ghl-action:test-whatsapp:1") {
      assert.equal(dispatch.action_type, "message");
      assert.equal(dispatch.contact_id, "ghl-contact-action-1");
      assert.equal(dispatch.channel, "whatsapp");
      assert.deepEqual(dispatch.payload, { message: "Approved test reply" });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ conversationId: "ghl-conversation-action-1", messageId: "ghl-message-action-1" }));
      return;
    }
    assert.equal(dispatch.contact_id, lifecycleContactId);
    assert.equal(dispatch.conversation_id, lifecycleProviderConversationId);
    const expectedPayloads = {
      message: { message: "The approved Growth plan is USD 99 per month. I can arrange the approved consultation now." },
      qualification: { temperature: "hot", reason: "Lead confirmed purchase intent after the grounded pricing reply", confidence: 0.94, next_action: "Book the approved consultation" },
      appointment: { calendar_id: "calendar-test-1", start_time: "2026-07-20T10:00:00Z", end_time: "2026-07-20T10:30:00Z", title: "Growth plan consultation" },
      opportunity: { opportunity_id: "opportunity-test-1", pipeline_id: "pipeline-test-1", pipeline_stage_id: "stage-qualified-1", name: "Lifecycle Test Lead - Growth plan", status: "open", monetary_value: 99 },
    };
    assert.deepEqual(dispatch.payload, expectedPayloads[dispatch.action_type]);
    assert.equal(dispatch.channel, dispatch.action_type === "message" ? "whatsapp" : "system");
    lifecycleDispatches.push({
      at: new Date().toISOString(), job_id: body.job_id, operation_id: body.operation_id,
      action_type: dispatch.action_type, idempotency_key: key, request_body: dispatch,
    });
    const responses = {
      message: { conversationId: lifecycleProviderConversationId, messageId: "sim-message-1" },
      qualification: { internal: true, reference: `tanaghom:qualification:${lifecycleContactId}` },
      appointment: { appointment: { id: "sim-appointment-1" } },
      opportunity: { opportunity: { id: "sim-opportunity-1" } },
    };
    assert.ok(responses[dispatch.action_type], `unexpected lifecycle action ${dispatch.action_type}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(responses[dispatch.action_type]));
    return;
  }
  response.writeHead(404).end();
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  server.listen(gatewayPort, gatewayBindHost); await once(server, "listening");
  await pool.query("ALTER ROLE tanaghom_n8n_worker LOGIN PASSWORD 'integration-only'");
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=false, reason='Disposable GHL workflow test' WHERE provider='ghl'");
  await pool.query(`INSERT INTO tanaghom.integration_connections
    (organization_id,provider,status,base_url,credential_kind,credential_ciphertext,credential_nonce,
     credential_auth_tag,credential_key_version,secret_last_four,configuration,configured_by,last_tested_at,
     last_test_status)
    VALUES ('10000000-0000-4000-8000-000000000001','ghl','connected','https://services.leadconnectorhq.com',
      'private_token',decode('01','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
      '{"location_id":"location-test-1"}','00000000-0000-4000-8000-000000000001',now(),'passed')
    ON CONFLICT (organization_id,provider) DO UPDATE SET
      status='connected',base_url=EXCLUDED.base_url,credential_kind=EXCLUDED.credential_kind,
      credential_ciphertext=EXCLUDED.credential_ciphertext,credential_nonce=EXCLUDED.credential_nonce,
      credential_auth_tag=EXCLUDED.credential_auth_tag,credential_key_version=EXCLUDED.credential_key_version,
      secret_last_four=EXCLUDED.secret_last_four,configuration=EXCLUDED.configuration,
      configured_by=EXCLUDED.configured_by,last_tested_at=now(),last_test_status='passed',
      last_error_code=NULL,disconnected_at=NULL`);
  await pool.query(`INSERT INTO tanaghom.leads (id,campaign_id,name,contact_email,contact_phone,status)
    VALUES ($1,'20000000-0000-4000-8000-000000000001','GHL Workflow Lead','workflow-lead@example.test','+15555550111','new')`, [leadId]);
  const queued = await pool.query("SELECT * FROM tanaghom.queue_ghl_contact_upsert($1,'00000000-0000-4000-8000-000000000001')", [leadId]);
  const replay = await pool.query("SELECT * FROM tanaghom.queue_ghl_contact_upsert($1,'00000000-0000-4000-8000-000000000001')", [leadId]);
  assert.equal(replay.rows[0].job_id, queued.rows[0].job_id);
  await pool.query(`
    UPDATE tanaghom.organization_crm_policies SET action_mode='manual',
      proactive_message_mode='approved_templates',action_emergency_stop=false,
      action_emergency_reason='Disposable governed action test',
      action_allowed_channels=ARRAY['whatsapp'],action_quiet_hours_start=time '01:00',
      action_quiet_hours_end=time '02:00',action_timezone='UTC'
    WHERE organization_id='10000000-0000-4000-8000-000000000001';
    INSERT INTO tanaghom.conversations (
      id,organization_id,provider_conversation_id,contact_id,state,reply_authority,
      assigned_user_id,owner_user_id,ownership_epoch,ownership_reason,last_event_at,last_activity_at
    ) VALUES (
      '${actionConversationId}','10000000-0000-4000-8000-000000000001','ghl-conversation-action-1',
      'ghl-contact-action-1','human_owned','human','00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',1,'Disposable approved action',now(),now()
    );
    INSERT INTO tanaghom.ghl_message_template_versions (
      id,organization_id,template_key,version,channel,purpose,language,body,status,
      created_by,approved_by,approved_at
    ) VALUES (
      '65000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001',
      'workflow-approved-test',1,'whatsapp','proactive','en','Approved test reply','approved',
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',now()
    );
    INSERT INTO tanaghom.ghl_contact_channel_policies (
      organization_id,contact_id,channel,consent_status,evidence,changed_by
    ) VALUES (
      '10000000-0000-4000-8000-000000000001','ghl-contact-action-1','whatsapp','opted_in',
      'Disposable explicit test consent','00000000-0000-4000-8000-000000000001'
    );
  `);
  const actionQueued = await pool.query(
    `SELECT * FROM tanaghom.queue_ghl_action($1,'message','proactive','whatsapp',$2::jsonb,$3,NULL,$4,1,NULL,$5)`,
    [actionConversationId, JSON.stringify({ message: "Approved test reply" }),
     "65000000-0000-4000-8000-000000000022", "00000000-0000-4000-8000-000000000001",
     "ghl-action:test-whatsapp:1"],
  );
  const actionReplay = await pool.query(
    `SELECT * FROM tanaghom.queue_ghl_action($1,'message','proactive','whatsapp',$2::jsonb,$3,NULL,$4,1,NULL,$5)`,
    [actionConversationId, JSON.stringify({ message: "Approved test reply" }),
     "65000000-0000-4000-8000-000000000022", "00000000-0000-4000-8000-000000000001",
     "ghl-action:test-whatsapp:1"],
  );
  assert.equal(actionReplay.rows[0].job_id, actionQueued.rows[0].job_id);
  assert.equal(actionReplay.rows[0].replayed, true);

  const database = new URL(databaseUrl);
  const credentials = [
    { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL", type: "postgres", data: {
      host: containerHost, database: database.pathname.slice(1), user: "tanaghom_n8n_worker", password: "integration-only",
      port: Number(database.port || 5432), ssl: "disable",
    } },
    { id: "62000000-0000-4000-8000-000000000004", name: "Tanaghom Integration Gateway", type: "httpHeaderAuth",
      data: { name: "Authorization", value: "Bearer integration-only-worker-token-32" } },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  const workflow = JSON.parse(await readFile(join(root, "n8n", "workflows", "phase5", "ghl-contact-sync.v1.json"), "utf8"));
  workflow.nodes.find((entry) => entry.name === "Upsert GHL Contact").parameters.url = `http://${containerHost}:${gatewayPort}/api/internal/integrations/ghl/contact`;
  await writeFile(join(temporary, "workflow.json"), JSON.stringify(workflow));
  const actionWorkflow = JSON.parse(await readFile(join(root, "n8n", "workflows", "phase5", "governed-ghl-actions.v1.json"), "utf8"));
  actionWorkflow.nodes.find((entry) => entry.name === "Execute Governed GHL Action").parameters.url = `http://${containerHost}:${gatewayPort}/api/internal/integrations/ghl/action`;
  await writeFile(join(temporary, "action-workflow.json"), JSON.stringify(actionWorkflow));
  await chmod(temporary, 0o755); await chmod(join(temporary, "credentials.json"), 0o644); await chmod(join(temporary, "workflow.json"), 0o644); await chmod(join(temporary, "action-workflow.json"), 0o644);

  await run("docker", ["volume", "create", volume]);
  const dockerBase = ["run", "--rm", "--network", "host", "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32",
    "-e", "N8N_USER_MANAGEMENT_DISABLED=true", "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SSRF_PROTECTION_ENABLED=false",
    "-e", `TANAGHOM_INTEGRATION_GATEWAY_URL=http://${containerHost}:${gatewayPort}`,
    "-v", `${volume}:/home/node/.n8n`, "-v", `${temporary}:/fixtures:ro`, image];
  await run("docker", [...dockerBase, "import:credentials", "--input=/fixtures/credentials.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/workflow.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/action-workflow.json"]);
  const execution = await run("docker", [...dockerBase, "execute", "--id=phase5GhlContactUpsertV1", "--rawOutput"]);
  const actionExecution = await run("docker", [...dockerBase, "execute", "--id=phase5GovernedGhlActionsV1", "--rawOutput"]);

  await pool.query(`INSERT INTO tanaghom.app_users (id,email,display_name,kind,role,organization_id)
    VALUES ($1,'lifecycle-sales-agent@example.test','Lifecycle Sales Agent','service','service',
      '10000000-0000-4000-8000-000000000001')`, [lifecycleServiceUserId]);
  await pool.query(`INSERT INTO tanaghom.leads (
      id,campaign_id,name,contact_email,contact_phone,status,ghl_contact_id
    ) VALUES ($1,'20000000-0000-4000-8000-000000000001','Lifecycle Test Lead',
      'lifecycle-lead@example.test','+15555550131','new',$2)`,
  [lifecycleLeadId, lifecycleContactId]);
  await pool.query(`UPDATE tanaghom.organization_crm_policies SET
      conversation_processing_mode='shadow',conversation_emergency_stop=false,
      conversation_emergency_reason='Disposable lifecycle supervisor gate opened',
      action_mode='assisted',action_emergency_stop=false,
      action_emergency_reason='Disposable lifecycle action gate opened',
      action_allowed_channels=ARRAY['whatsapp'],proactive_message_mode='approved_templates'
    WHERE organization_id='10000000-0000-4000-8000-000000000001'`);

  const draft = await pool.query(
    `SELECT * FROM tanaghom.create_sales_knowledge_draft(
      'lifecycle_growth_plan','Growth plan approved facts','pricing','en',
      'The approved Growth plan price is USD 99 per month. An approved thirty-minute consultation may be booked for interested leads.',
      '[{"fact":"growth_plan_monthly_price","value":99,"currency":"USD"}]'::jsonb,
      'customer_entry','disposable-lifecycle-evidence',$1
    )`,
    ["00000000-0000-4000-8000-000000000001"],
  );
  const knowledgeSourceId = draft.rows[0].source_id;
  const knowledgeVersionId = draft.rows[0].version_id;
  for (const action of ["review", "approve", "activate"]) {
    await pool.query("SELECT * FROM tanaghom.transition_sales_knowledge_version($1,$2,$3,NULL)",
      [knowledgeVersionId, action, "00000000-0000-4000-8000-000000000001"]);
  }

  const inboundContract = {
    contract_version: "phase5.ghl-inbound-event.v1",
    provider_event_id: "lifecycle-inbound-message-1",
    provider_event_type: "InboundMessage",
    location_id: "location-test-1",
    contact_id: lifecycleContactId,
    conversation_id: lifecycleProviderConversationId,
    message_id: "lifecycle-provider-message-1",
    channel: "whatsapp",
    direction: "inbound",
    occurred_at: new Date().toISOString(),
    details: { body: "What is the approved Growth plan price, and can I book a consultation?" },
  };
  const inboundHash = createHash("sha256").update(JSON.stringify(inboundContract)).digest("hex");
  const accepted = await pool.query("SELECT * FROM tanaghom.accept_ghl_inbound_event($1::jsonb,$2)",
    [JSON.stringify(inboundContract), inboundHash]);
  const duplicate = await pool.query("SELECT * FROM tanaghom.accept_ghl_inbound_event($1::jsonb,$2)",
    [JSON.stringify(inboundContract), inboundHash]);
  assert.equal(accepted.rows[0].duplicate, false);
  assert.equal(duplicate.rows[0].duplicate, true);
  assert.equal(duplicate.rows[0].event_id, accepted.rows[0].event_id);
  assert.equal(duplicate.rows[0].delivery_count, 2);

  const inboundClaim = await pool.query("SELECT * FROM tanaghom.claim_ghl_inbound_event_job()");
  assert.equal(inboundClaim.rowCount, 1);
  assert.equal(inboundClaim.rows[0].event_id, accepted.rows[0].event_id);
  const intelligence = await pool.query("SELECT * FROM tanaghom.prepare_conversation_intelligence($1)",
    [inboundClaim.rows[0].job_id]);
  const intelligenceRequest = intelligence.rows[0].request_body;
  assert.equal(intelligenceRequest.system_policy.external_actions_allowed, false);
  const citedKnowledge = intelligenceRequest.retrieved_knowledge.find(
    (entry) => entry.source_id === knowledgeSourceId && entry.source_version_id === knowledgeVersionId,
  );
  assert.ok(citedKnowledge, "approved lifecycle knowledge was not retrieved");
  const groundedReply = "The approved Growth plan is USD 99 per month. I can arrange the approved consultation now.";
  const proposal = await pool.query(
    "SELECT tanaghom.persist_conversation_intelligence_proposal($1,$2::jsonb) AS proposal_id",
    [inboundClaim.rows[0].job_id, JSON.stringify({
      contract_version: "phase5.conversation-intelligence-output.v1",
      prompt_version: "phase5.conversation-intelligence.prompt.v1",
      model_name: "simulated-gemma-lifecycle",
      language: "en", intent: "booking", urgency: "normal", sentiment: "positive",
      sales_stage: "decision", risk_categories: [], next_best_action: "respond",
      confidence: 0.94, answer_status: "proposal", proposed_reply: groundedReply,
      citations: [{ source_id: knowledgeSourceId, source_version_id: knowledgeVersionId,
        content_fingerprint: citedKnowledge.content_fingerprint }],
      escalation: { required: false, category: null, reason: null },
      conversation_summary: { language: "en", summary: "Lead asked for the approved Growth plan price and a consultation.",
        input_event_ids: [accepted.rows[0].event_id] },
      external_action_count: 0,
    })],
  );
  const proposalId = proposal.rows[0].proposal_id;
  let conversation = (await pool.query(
    "SELECT * FROM tanaghom.conversations WHERE provider_conversation_id=$1",
    [lifecycleProviderConversationId],
  )).rows[0];
  assert.equal(conversation.state, "awaiting_approval");
  assert.equal(conversation.latest_proposal_id, proposalId);
  const resumed = await pool.query(
    "SELECT * FROM tanaghom.transition_supervised_conversation($1,'resume_ai',$2,NULL,$3,$4,$5)",
    [conversation.id, "00000000-0000-4000-8000-000000000001",
      "Grounded reply approved for the disposable lifecycle",
      conversation.conversation_version, "65000000-0000-4000-8000-000000000040"],
  );
  const lease = await pool.query(
    "SELECT * FROM tanaghom.claim_conversation_ai_lease($1,$2,300,$3)",
    [conversation.id, resumed.rows[0].ownership_epoch, "65000000-0000-4000-8000-000000000041"],
  );
  conversation = (await pool.query("SELECT * FROM tanaghom.conversations WHERE id=$1", [conversation.id])).rows[0];

  const lifecycleActions = [
    { type: "message", channel: "whatsapp", key: "ghl-lifecycle:reply:1",
      command: "65000000-0000-4000-8000-000000000042", payload: { message: groundedReply },
      expectedReference: "sim-message-1" },
    { type: "qualification", channel: "system", key: "ghl-lifecycle:qualification:1",
      command: "65000000-0000-4000-8000-000000000043",
      payload: { temperature: "hot", reason: "Lead confirmed purchase intent after the grounded pricing reply",
        confidence: 0.94, next_action: "Book the approved consultation" },
      expectedReference: `tanaghom:qualification:${lifecycleContactId}` },
    { type: "appointment", channel: "system", key: "ghl-lifecycle:appointment:1",
      command: "65000000-0000-4000-8000-000000000044",
      payload: { calendar_id: "calendar-test-1", start_time: "2026-07-20T10:00:00Z",
        end_time: "2026-07-20T10:30:00Z", title: "Growth plan consultation" },
      expectedReference: "sim-appointment-1" },
    { type: "opportunity", channel: "system", key: "ghl-lifecycle:opportunity:1",
      command: "65000000-0000-4000-8000-000000000045",
      payload: { opportunity_id: "opportunity-test-1", pipeline_id: "pipeline-test-1",
        pipeline_stage_id: "stage-qualified-1", name: "Lifecycle Test Lead - Growth plan",
        status: "open", monetary_value: 99 }, expectedReference: "sim-opportunity-1" },
  ];
  const lifecycleJobs = [];
  for (const action of lifecycleActions) {
    const queuedAction = await pool.query(
      `SELECT * FROM tanaghom.queue_ghl_action($1,$2,'inbound',$3,$4::jsonb,NULL,$5,NULL,$6,$7,$8)`,
      [conversation.id, action.type, action.channel, JSON.stringify(action.payload), accepted.rows[0].event_id,
        conversation.ownership_epoch, lease.rows[0].lease_token, action.key],
    );
    assert.equal(queuedAction.rows[0].status, "awaiting_approval");
    const replayedAction = await pool.query(
      `SELECT * FROM tanaghom.queue_ghl_action($1,$2,'inbound',$3,$4::jsonb,NULL,$5,NULL,$6,$7,$8)`,
      [conversation.id, action.type, action.channel, JSON.stringify(action.payload), accepted.rows[0].event_id,
        conversation.ownership_epoch, lease.rows[0].lease_token, action.key],
    );
    assert.equal(replayedAction.rows[0].job_id, queuedAction.rows[0].job_id);
    assert.equal(replayedAction.rows[0].replayed, true);
    await pool.query("SELECT tanaghom.decide_ghl_action($1,$2,'approved',$3,$4)",
      [queuedAction.rows[0].job_id, "00000000-0000-4000-8000-000000000001",
        `Approved disposable ${action.type} action`, action.command]);
    const output = await run("docker", [...dockerBase, "execute", "--id=phase5GovernedGhlActionsV1", "--rawOutput"]);
    const completed = (await pool.query(
      `SELECT job.id,job.action_type,job.status,job.provider_reference,job.created_at,
        job.dispatched_at,job.finished_at,job.initiating_event_id,job.proposal_id,
        job.requested_by_agent_id,job.idempotency_key,job.request_fingerprint,job.policy_snapshot,
        (SELECT jsonb_agg(jsonb_build_object('outcome_type',outcome.outcome_type,
          'provider_reference',outcome.provider_reference,'occurred_at',outcome.occurred_at)
          ORDER BY outcome.occurred_at,outcome.id)
         FROM tanaghom.ghl_action_outcomes outcome WHERE outcome.action_job_id=job.id) AS outcomes
       FROM tanaghom.ghl_action_jobs job WHERE job.id=$1`,
      [queuedAction.rows[0].job_id],
    )).rows[0];
    assert.equal(completed.status, "succeeded", output.slice(-4000));
    assert.equal(completed.provider_reference, action.expectedReference);
    assert.equal(completed.initiating_event_id, accepted.rows[0].event_id);
    assert.equal(completed.proposal_id, proposalId);
    assert.equal(completed.requested_by_agent_id, lifecycleServiceUserId);
    lifecycleJobs.push(completed);
  }

  const lifecycleLead = (await pool.query("SELECT status,temperature FROM tanaghom.leads WHERE id=$1", [lifecycleLeadId])).rows[0];
  assert.deepEqual(lifecycleLead, { status: "qualified", temperature: "hot" });
  assert.equal(lifecycleDispatches.length, 4);
  const completionAudits = await pool.query(
    `SELECT entity_id,actor_user_id,created_at FROM tanaghom.agent_actions_log
      WHERE action_type='ghl.action_succeeded' AND entity_id=ANY($1::uuid[]) ORDER BY created_at`,
    [lifecycleJobs.map((job) => job.id)],
  );
  assert.equal(completionAudits.rowCount, 4);
  assert.ok(completionAudits.rows.every((row) => row.actor_user_id === lifecycleServiceUserId));
  const ownershipEvidence = await pool.query(
    "SELECT action,new_state,new_reply_authority,reason,occurred_at FROM tanaghom.conversation_ownership_history WHERE conversation_id=$1 ORDER BY occurred_at,id",
    [conversation.id],
  );
  assert.ok(ownershipEvidence.rows.some((row) => row.action === "proposal_ready" && row.new_state === "awaiting_approval"));
  assert.ok(ownershipEvidence.rows.some((row) => row.action === "resume_ai" && row.new_reply_authority === "ai"));

  await mkdir(dirname(lifecycleEvidencePath), { recursive: true });
  await writeFile(lifecycleEvidencePath, `${JSON.stringify({
    contract_version: "phase5.sales-lifecycle-evidence.v1",
    generated_at: new Date().toISOString(), scenario: "disposable-grounded-inbound-to-opportunity",
    boundaries: { database: "disposable", provider: "simulated-local-gateway", gemma: "simulated-contract-output",
      customer_credentials_used: false, external_publish_or_message: false },
    inbound: { event_id: accepted.rows[0].event_id, provider_event_id: inboundContract.provider_event_id,
      duplicate_delivery_count: duplicate.rows[0].delivery_count, question: inboundContract.details.body },
    intelligence: { job_id: inboundClaim.rows[0].job_id, proposal_id: proposalId,
      model: "simulated-gemma-lifecycle", reply: groundedReply,
      citation: { source_id: knowledgeSourceId, version_id: knowledgeVersionId,
        fingerprint: citedKnowledge.content_fingerprint } },
    supervisor: { conversation_id: conversation.id, decisions: ownershipEvidence.rows },
    actions: lifecycleJobs.map((job) => ({ ...job,
      simulated_dispatch: lifecycleDispatches.find((dispatch) => dispatch.job_id === job.id) })),
    final_state: { lead_status: lifecycleLead.status, lead_temperature: lifecycleLead.temperature,
      provider_dispatch_count: lifecycleDispatches.length, completion_audit_count: completionAudits.rowCount },
  }, null, 2)}\n`, "utf8");

  assert.equal(contactRequestCount, 1, execution.slice(-4000));
  assert.equal(actionRequestCount, 5, actionExecution.slice(-4000));
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE id=$1", [queued.rows[0].job_id])).rows[0].status, "succeeded");
  assert.equal((await pool.query("SELECT ghl_contact_id FROM tanaghom.leads WHERE id=$1", [leadId])).rows[0].ghl_contact_id, "ghl-contact-123");
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.external_operations WHERE provider='ghl' AND operation_type='upsert_contact' AND status='succeeded'")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT status FROM tanaghom.ghl_action_jobs WHERE id=$1", [actionQueued.rows[0].job_id])).rows[0].status, "succeeded");
  assert.equal((await pool.query("SELECT provider_reference FROM tanaghom.ghl_action_jobs WHERE id=$1", [actionQueued.rows[0].job_id])).rows[0].provider_reference, "ghl-message-action-1");
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.external_operations WHERE provider='ghl' AND operation_type='action.message' AND idempotency_key='ghl-action:test-whatsapp:1' AND status='succeeded'")).rows[0].count, 1);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find((entry) => entry.type === "n8n-nodes-base.scheduleTrigger").disabled, true);
  assert.equal(workflow.settings.saveDataErrorExecution, "none");
  assert.equal(actionWorkflow.active, false);
  assert.equal(actionWorkflow.nodes.find((entry) => entry.type === "n8n-nodes-base.scheduleTrigger").disabled, true);
  assert.equal(actionWorkflow.settings.saveDataErrorExecution, "none");
  console.log("PASS: inactive GHL workflows proved contact sync and the contiguous grounded inbound-to-opportunity lifecycle without credential exposure.");
} finally {
  server.close();
  await pool.query(`
    UPDATE tanaghom.automation_platform_controls SET emergency_stop=true, reason='Disposable GHL workflow test complete' WHERE provider='ghl';
    DELETE FROM tanaghom.outbox_events WHERE aggregate_id IN ('${leadId}','${lifecycleLeadId}');
    ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_update;
    ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_delete;
    DELETE FROM tanaghom.notifications WHERE entity_id IN (
      SELECT id FROM tanaghom.ghl_action_jobs WHERE conversation_id IN (
        '${actionConversationId}',(SELECT id FROM tanaghom.conversations WHERE provider_conversation_id='${lifecycleProviderConversationId}')
      )
    ) OR entity_id=(SELECT id FROM tanaghom.conversations WHERE provider_conversation_id='${lifecycleProviderConversationId}');
    DELETE FROM tanaghom.agent_actions_log WHERE entity_id IN ('${leadId}','${lifecycleLeadId}','${actionConversationId}')
      OR actor_user_id='${lifecycleServiceUserId}' OR entity_type='ghl_action_job'
      OR entity_id IN (SELECT id FROM tanaghom.ghl_inbound_events WHERE provider_event_id='lifecycle-inbound-message-1')
      OR entity_id IN (SELECT id FROM tanaghom.conversations WHERE provider_conversation_id='${lifecycleProviderConversationId}')
      OR entity_id IN (SELECT id FROM tanaghom.sales_knowledge_versions WHERE source_id IN (
        SELECT id FROM tanaghom.sales_knowledge_sources WHERE source_key='lifecycle_growth_plan'));
    ALTER TABLE tanaghom.ghl_action_outcomes DISABLE TRIGGER ghl_action_outcome_no_delete;
    ALTER TABLE tanaghom.ghl_action_outcomes DISABLE TRIGGER ghl_action_outcome_no_update;
    DELETE FROM tanaghom.ghl_action_jobs WHERE conversation_id='${actionConversationId}'
      OR conversation_id IN (SELECT id FROM tanaghom.conversations WHERE provider_conversation_id='${lifecycleProviderConversationId}');
    ALTER TABLE tanaghom.ghl_action_outcomes ENABLE TRIGGER ghl_action_outcome_no_delete;
    ALTER TABLE tanaghom.ghl_action_outcomes ENABLE TRIGGER ghl_action_outcome_no_update;
    DELETE FROM tanaghom.external_operations WHERE provider='ghl'
      AND (operation_type='upsert_contact' OR idempotency_key='ghl-action:test-whatsapp:1'
        OR idempotency_key LIKE 'ghl-lifecycle:%');
    DELETE FROM tanaghom.ghl_contact_channel_policies WHERE contact_id='ghl-contact-action-1';
    DELETE FROM tanaghom.ghl_message_template_versions WHERE id='65000000-0000-4000-8000-000000000022';
    DELETE FROM tanaghom.conversations WHERE id='${actionConversationId}';
    DELETE FROM tanaghom.conversations WHERE provider_conversation_id='${lifecycleProviderConversationId}';
    DELETE FROM tanaghom.conversation_intelligence_proposals WHERE conversation_id='${lifecycleProviderConversationId}';
    DELETE FROM tanaghom.conversation_summary_versions WHERE conversation_id='${lifecycleProviderConversationId}';
    DELETE FROM tanaghom.ghl_inbound_events WHERE provider_event_id='lifecycle-inbound-message-1';
    DELETE FROM tanaghom.agent_jobs WHERE (job_type='lead.ghl.contact_upsert' AND input->>'lead_id'='${leadId}')
      OR (job_type='conversation.ghl.inbound_event' AND input->>'organization_id'='10000000-0000-4000-8000-000000000001');
    DELETE FROM tanaghom.sales_knowledge_sources WHERE source_key='lifecycle_growth_plan';
    ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_update;
    ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_delete;
    DELETE FROM tanaghom.leads WHERE id IN ('${leadId}','${lifecycleLeadId}');
    DELETE FROM tanaghom.app_users WHERE id='${lifecycleServiceUserId}';
    DELETE FROM tanaghom.integration_connections WHERE provider='ghl';
    UPDATE tanaghom.agents SET status='idle' WHERE code='sales_crm' AND status <> 'disabled';
  `).catch((error) => {
    cleanupFailure = error;
    console.warn(`Disposable GHL fixture cleanup failed: ${error.message}`);
  });
  await pool.end(); await run("docker", ["volume", "rm", "-f", volume]).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
  if (cleanupFailure) throw cleanupFailure;
}
