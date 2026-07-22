#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const [action, canaryId, encodedReason] = process.argv.slice(2);
const allowed = new Set([
  "check-database",
  "snapshot-controls",
  "seed",
  "assert-only-canary",
  "unlock",
  "restore-locks",
  "verify-ready",
  "finalize",
  "verify-finalized",
  "quarantine",
]);
const pattern = /^conversationcanary-[0-9]{8}T[0-9]{6}Z$/;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!allowed.has(action) || !pattern.test(canaryId ?? "")) {
  throw new Error(`usage: canary-operator.mjs ${[...allowed].join("|")} conversationcanary-YYYYMMDDTHHMMSSZ [reason-base64]`);
}

const connectionUrl = new URL(process.env.DATABASE_URL);
if (process.env.TANAGHOM_DATABASE_SSL_MODE) {
  if (process.env.TANAGHOM_DATABASE_SSL_MODE !== "verify-full") throw new Error("TANAGHOM_DATABASE_SSL_MODE must be verify-full");
  connectionUrl.searchParams.set("sslmode", "verify-full");
}
const client = new pg.Client({ connectionString: connectionUrl.toString(), application_name: "tanaghom-conversation-shadow-canary" });
await client.connect();

const stamp = canaryId.slice("conversationcanary-".length).toLowerCase();
const identity = {
  slug: `conversation-canary-${stamp}`,
  email: `owner-${stamp}@conversation-canary.test`,
  locationId: `canary_${stamp.replace(/[^a-z0-9]/g, "")}`,
  providerEventId: `event_${stamp.replace(/[^a-z0-9]/g, "")}`,
  conversationId: `conversation_${stamp.replace(/[^a-z0-9]/g, "")}`,
  contactId: `contact_${stamp.replace(/[^a-z0-9]/g, "")}`,
  messageId: `message_${stamp.replace(/[^a-z0-9]/g, "")}`,
  sourceKey: `canary_growth_price_${stamp.replace(/[^a-z0-9]/g, "")}`,
};

function decodeReason(value) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("a base64-encoded original GHL reason is required");
  const reason = Buffer.from(value, "base64").toString("utf8");
  if (Buffer.from(reason, "utf8").toString("base64") !== value || reason.trim().length < 3 || reason.length > 500) {
    throw new Error("original GHL reason is invalid");
  }
  return reason;
}

async function organization(lock = false) {
  const result = await client.query(`SELECT * FROM tanaghom.organizations WHERE slug=$1${lock ? " FOR UPDATE" : ""}`, [identity.slug]);
  if (result.rowCount !== 1) throw new Error("synthetic canary organization not found");
  return result.rows[0];
}

async function checkDatabase() {
  await client.query("BEGIN READ ONLY");
  try {
    const migration = await client.query("SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1");
    if (migration.rows[0]?.version !== "0025_runtime_agent_reconciliation") throw new Error("unexpected database migration");
    const collision = await client.query(`SELECT
      (SELECT count(*) FROM tanaghom.organizations WHERE slug=$1)::int organizations,
      (SELECT count(*) FROM tanaghom.app_users WHERE email=$2)::int users,
      (SELECT count(*) FROM tanaghom.integration_connections WHERE provider='ghl' AND configuration->>'location_id'=$3)::int locations`,
    [identity.slug, identity.email, identity.locationId]);
    if (Object.values(collision.rows[0]).some((count) => count !== 0)) throw new Error("synthetic canary identity already exists");
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ database_tls: "verified", transaction: "read_only", migration: migration.rows[0].version, identity_available: true }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function snapshotControls() {
  const row = (await client.query("SELECT emergency_stop,reason FROM tanaghom.automation_platform_controls WHERE provider='ghl'")).rows[0];
  if (!row?.emergency_stop) throw new Error("global GHL emergency stop is not active");
  console.log(JSON.stringify({ emergency_stop: true, reason_base64: Buffer.from(row.reason, "utf8").toString("base64") }));
}

async function seed() {
  await client.query("BEGIN");
  try {
    if ((await client.query("SELECT 1 FROM tanaghom.organizations WHERE slug=$1", [identity.slug])).rowCount) throw new Error("canary already exists");
    const org = (await client.query("INSERT INTO tanaghom.organizations(slug,name) VALUES($1,$2) RETURNING *", [
      identity.slug,
      `Conversation Intelligence Canary ${stamp}.test`,
    ])).rows[0];
    const owner = (await client.query(`INSERT INTO tanaghom.app_users
      (email,display_name,kind,role,is_active,auth_subject,accepted_at,organization_id)
      VALUES($1,$2,'human','owner',true,$3,statement_timestamp(),$4) RETURNING *`, [
      identity.email,
      "Synthetic Canary Owner",
      randomUUID(),
      org.id,
    ])).rows[0];

    const connection = (await client.query(`INSERT INTO tanaghom.integration_connections
      (organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
       credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,
       configuration,configured_by,last_tested_at,last_test_status)
      VALUES($1,'ghl','connected','https://ghl-shadow-canary.invalid.test','private_token',
       $2,$3,$4,1,'test',jsonb_build_object('location_id',$5::text,'synthetic',true),$6,
       statement_timestamp(),'passed') RETURNING *`, [
      org.id,
      Buffer.from([1]),
      Buffer.alloc(12, 2),
      Buffer.alloc(16, 3),
      identity.locationId,
      owner.id,
    ])).rows[0];

    await client.query(`UPDATE tanaghom.organization_crm_policies SET
      contact_sync_mode='manual',conversation_processing_mode='shadow',
      conversation_emergency_stop=true,
      conversation_emergency_reason='Synthetic shadow canary remains stopped until the bounded execution',
      action_mode='manual',proactive_message_mode='disabled',action_emergency_stop=true,
      changed_by=$2,changed_at=statement_timestamp()
      WHERE organization_id=$1`, [org.id, owner.id]);

    const knowledge = (await client.query(`SELECT * FROM tanaghom.create_sales_knowledge_draft(
      $1,'Tanaghom Canary Growth plan price','pricing','en',
      'The approved Tanaghom Canary Growth plan price is USD 99 per month.',
      '[{"fact":"monthly_price","currency":"USD","amount":99}]'::jsonb,
      'operator_note',$2,$3)`, [identity.sourceKey, `synthetic://${canaryId}`, owner.id])).rows[0];
    await client.query("SELECT * FROM tanaghom.transition_sales_knowledge_version($1,'review',$2,NULL)", [knowledge.version_id, owner.id]);
    await client.query("SELECT * FROM tanaghom.transition_sales_knowledge_version($1,'approve',$2,NULL)", [knowledge.version_id, owner.id]);
    await client.query("SELECT * FROM tanaghom.transition_sales_knowledge_version($1,'activate',$2,NULL)", [knowledge.version_id, owner.id]);

    const event = {
      contract_version: "phase5.ghl-inbound-event.v1",
      provider_event_id: identity.providerEventId,
      provider_event_type: "InboundMessage",
      location_id: identity.locationId,
      contact_id: identity.contactId,
      conversation_id: identity.conversationId,
      message_id: identity.messageId,
      channel: "whatsapp",
      direction: "inbound",
      occurred_at: new Date().toISOString(),
      details: { body: "What is the approved Tanaghom Canary Growth plan price?" },
      synthetic: true,
    };
    const body = JSON.stringify(event);
    const accepted = (await client.query("SELECT * FROM tanaghom.accept_ghl_inbound_event($1::jsonb,$2)", [
      body,
      createHash("sha256").update(body).digest("hex"),
    ])).rows[0];
    if (!accepted || accepted.duplicate) throw new Error("synthetic inbound event was not accepted exactly once");
    await client.query("COMMIT");
    console.log(JSON.stringify({
      organization_id: org.id,
      owner_id: owner.id,
      connection_id: connection.id,
      event_id: accepted.event_id,
      knowledge_version_id: knowledge.version_id,
      global_stop_remained_active: true,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function assertOnlyCanary() {
  const org = await organization();
  const counts = (await client.query(`SELECT
    (SELECT count(*) FROM tanaghom.integration_connections WHERE provider='ghl' AND status='connected')::int connected_ghl,
    (SELECT count(*) FROM tanaghom.integration_connections WHERE organization_id=$1 AND provider='ghl' AND status='connected')::int canary_connections,
    (SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND status='queued' AND available_at<=statement_timestamp() AND attempt<max_attempts)::int claimable_jobs,
    (SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND status='queued' AND input->>'organization_id'=$1::text)::int canary_jobs,
    (SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND status='running')::int running_jobs,
    (SELECT count(*) FROM tanaghom.ghl_inbound_events WHERE status IN ('pending','processing'))::int open_events,
    (SELECT count(*) FROM tanaghom.ghl_inbound_events WHERE organization_id=$1 AND status='pending')::int canary_events,
    (SELECT count(*) FROM tanaghom.conversation_dependency_cooldowns WHERE blocked_until>statement_timestamp())::int cooldowns`, [org.id])).rows[0];
  const expected = { connected_ghl: 1, canary_connections: 1, claimable_jobs: 1, canary_jobs: 1, running_jobs: 0, open_events: 1, canary_events: 1, cooldowns: 0 };
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) throw new Error(`exclusive synthetic boundary failed: ${key}=${counts[key]}, expected ${value}`);
  }
  const policy = (await client.query(`SELECT policy.conversation_processing_mode,policy.conversation_emergency_stop,
      policy.action_mode,policy.action_emergency_stop,policy.proactive_message_mode,control.emergency_stop platform_stop
    FROM tanaghom.organization_crm_policies policy
    CROSS JOIN tanaghom.automation_platform_controls control
    WHERE policy.organization_id=$1 AND control.provider='ghl'`, [org.id])).rows[0];
  if (policy?.conversation_processing_mode !== "shadow" || !policy.conversation_emergency_stop || policy.action_mode !== "manual" || !policy.action_emergency_stop || policy.proactive_message_mode !== "disabled" || !policy.platform_stop) {
    throw new Error("synthetic organization or platform safety lock changed before execution");
  }
  console.log(JSON.stringify({ organization_id: org.id, ...counts, policy: "shadow-but-stopped", platform_stop: true }));
}

async function unlock() {
  await client.query("BEGIN");
  try {
    await client.query("SELECT provider FROM tanaghom.automation_platform_controls WHERE provider='ghl' FOR UPDATE");
    await assertOnlyCanary();
    const control = await client.query(`UPDATE tanaghom.automation_platform_controls SET
      emergency_stop=false,reason=$1 WHERE provider='ghl' AND emergency_stop=true RETURNING provider`,
    [`Controlled ${canaryId} proposal-only execution`]);
    if (control.rowCount !== 1) throw new Error("GHL platform stop could not enter the bounded canary state");
    const registry = await client.query(`UPDATE tanaghom.agent_workflow_registry SET
      runtime_state='active',trigger_state='disabled',runtime_verified_at=statement_timestamp(),runtime_evidence=$1
      WHERE code='conversation_intelligence_worker' AND runtime_state='imported_inactive' AND trigger_state='disabled' RETURNING code`,
    [`${canaryId}-running-one-execution`]);
    if (registry.rowCount !== 1) throw new Error("worker registry could not enter active/disabled state");
    await client.query("COMMIT");
    console.log(JSON.stringify({ platform_stop: false, registry: "active/disabled", bounded_to: canaryId }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function restoreLocks() {
  const reason = decodeReason(encodedReason);
  await client.query("BEGIN");
  try {
    await client.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,reason=$1 WHERE provider='ghl'", [reason]);
    const registry = await client.query(`UPDATE tanaghom.agent_workflow_registry SET
      runtime_state='imported_inactive',trigger_state='disabled',runtime_verified_at=statement_timestamp(),runtime_evidence=$1
      WHERE code='conversation_intelligence_worker' RETURNING code`, [`${canaryId}-restored-inactive`]);
    if (registry.rowCount !== 1) throw new Error("worker registry could not be restored");
    await client.query("COMMIT");
    console.log(JSON.stringify({ platform_stop: true, original_reason_restored: true, registry: "imported_inactive/disabled" }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function readySnapshot() {
  const org = await organization();
  const result = await client.query(`SELECT
    organization.id organization_id,organization.is_active organization_active,
    app.id owner_id,app.is_active owner_active,
    connection.status integration_status,
    job.id job_id,job.status job_status,job.attempt,job.finished_at,
    event.id event_id,event.status event_status,event.processed_at,
    proposal.id proposal_id,proposal.language,proposal.intent,proposal.answer_status,
    proposal.proposed_reply,proposal.citations,proposal.escalation_required,
    proposal.external_action_count,
    conversation.id conversation_id,conversation.state conversation_state,
    conversation.reply_authority,conversation.latest_proposal_id,
    (SELECT count(*)::int FROM tanaghom.conversation_supervisor_inbox inbox WHERE inbox.id=conversation.id) supervisor_inbox_rows,
    (SELECT count(*)::int FROM tanaghom.conversation_ownership_history history WHERE history.conversation_id=conversation.id AND history.action='proposal_ready') proposal_ready_transitions,
    (SELECT count(*)::int FROM jsonb_array_elements(proposal.citations) citation
      JOIN tanaghom.sales_knowledge_versions version ON version.id=(citation->>'source_version_id')::uuid
        AND version.organization_id=organization.id AND version.status='active'
        AND version.content_fingerprint=citation->>'content_fingerprint'
      JOIN tanaghom.sales_knowledge_sources source ON source.id=version.source_id
        AND source.id=(citation->>'source_id')::uuid) valid_citations,
    (SELECT count(*)::int FROM tanaghom.external_operations operation WHERE operation.correlation_id=job.correlation_id) canary_external_operations,
    (SELECT count(*)::int FROM tanaghom.ghl_action_jobs action_job WHERE action_job.organization_id=organization.id) canary_action_jobs,
    (SELECT count(*)::int FROM tanaghom.leads lead JOIN tanaghom.campaigns campaign ON campaign.id=lead.campaign_id WHERE campaign.organization_id=organization.id) canary_leads,
    (SELECT count(*)::int FROM tanaghom.posts post JOIN tanaghom.content_items item ON item.id=post.content_item_id JOIN tanaghom.campaigns campaign ON campaign.id=item.campaign_id WHERE campaign.organization_id=organization.id) canary_posts
  FROM tanaghom.organizations organization
  JOIN tanaghom.app_users app ON app.organization_id=organization.id AND app.email=$2
  JOIN tanaghom.integration_connections connection ON connection.organization_id=organization.id AND connection.provider='ghl'
  JOIN tanaghom.ghl_inbound_events event ON event.organization_id=organization.id
  JOIN tanaghom.agent_jobs job ON job.input->>'event_id'=event.id::text
  JOIN tanaghom.conversation_intelligence_proposals proposal ON proposal.job_id=job.id AND proposal.event_id=event.id
  JOIN tanaghom.conversations conversation ON conversation.organization_id=organization.id AND conversation.provider_conversation_id=event.conversation_id
  WHERE organization.slug=$1`, [identity.slug, identity.email]);
  if (result.rowCount !== 1) throw new Error("expected exactly one complete synthetic proposal path");
  return result.rows[0];
}

function assertReady(row) {
  if (!row.organization_active || !row.owner_active || row.integration_status !== "connected") throw new Error("synthetic fixture was finalized before verification");
  if (row.job_status !== "succeeded" || row.event_status !== "succeeded" || row.attempt !== 1 || !row.finished_at || !row.processed_at) throw new Error("synthetic job/event did not succeed exactly once");
  if (row.language !== "en" || row.answer_status !== "proposal" || row.escalation_required || row.external_action_count !== 0) throw new Error("synthetic proposal contract is not the required non-escalating English proposal");
  if (!row.proposed_reply?.includes("99")) throw new Error("synthetic proposal did not answer the approved price");
  if (!Array.isArray(row.citations) || row.citations.length < 1 || row.valid_citations !== row.citations.length) throw new Error("synthetic proposal lacks valid active citations");
  if (row.conversation_state !== "awaiting_approval" || row.reply_authority !== "none" || row.latest_proposal_id !== row.proposal_id || row.supervisor_inbox_rows !== 1 || row.proposal_ready_transitions !== 1) {
    throw new Error("synthetic proposal did not reach the exact Supervisor Inbox approval state");
  }
  if (row.canary_external_operations || row.canary_action_jobs || row.canary_leads || row.canary_posts) throw new Error("synthetic proposal produced a forbidden side effect");
}

async function verifyReady() {
  const row = await readySnapshot();
  assertReady(row);
  console.log(JSON.stringify(row));
}

async function finalize() {
  const snapshot = await readySnapshot();
  assertReady(snapshot);
  await client.query("BEGIN");
  try {
    const org = await organization(true);
    await client.query(`UPDATE tanaghom.integration_connections SET
      status='disconnected',credential_ciphertext=NULL,credential_nonce=NULL,
      credential_auth_tag=NULL,credential_key_version=NULL,secret_last_four=NULL,
      disconnected_at=statement_timestamp(),last_test_status=NULL,last_error_code=NULL
      WHERE organization_id=$1 AND provider='ghl'`, [org.id]);
    await client.query(`UPDATE tanaghom.organization_crm_policies SET
      contact_sync_mode='manual',conversation_processing_mode='paused',
      conversation_emergency_stop=true,
      conversation_emergency_reason='Synthetic canary completed and was quarantined inactive',
      action_mode='manual',proactive_message_mode='disabled',action_emergency_stop=true
      WHERE organization_id=$1`, [org.id]);
    await client.query("UPDATE tanaghom.organization_automation_policies SET postiz_draft_mode='manual' WHERE organization_id=$1", [org.id]);
    await client.query("UPDATE tanaghom.app_users SET is_active=false WHERE organization_id=$1", [org.id]);
    await client.query("UPDATE tanaghom.organizations SET is_active=false WHERE id=$1", [org.id]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ organization_id: org.id, organization_active: false, owner_active: false, integration: "disconnected-and-erased", evidence_retained: true }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function verifyFinalized() {
  const org = await organization();
  const row = (await client.query(`SELECT
    organization.is_active organization_active,
    (SELECT count(*)::int FROM tanaghom.app_users app WHERE app.organization_id=organization.id AND app.is_active) active_users,
    connection.status integration_status,connection.credential_ciphertext IS NULL ciphertext_erased,
    connection.credential_nonce IS NULL nonce_erased,connection.credential_auth_tag IS NULL auth_tag_erased,
    connection.credential_key_version IS NULL key_version_erased,connection.secret_last_four IS NULL last_four_erased,
    policy.contact_sync_mode,policy.conversation_processing_mode,policy.conversation_emergency_stop,
    policy.action_mode,policy.proactive_message_mode,policy.action_emergency_stop,
    automation.postiz_draft_mode,
    control.emergency_stop platform_stop,
    registry.runtime_state,registry.trigger_state,
    (SELECT count(*)::int FROM tanaghom.integration_connections WHERE provider='ghl' AND status='connected') connected_ghl,
    (SELECT count(*)::int FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND status IN ('queued','running')) open_conversation_jobs,
    (SELECT count(*)::int FROM tanaghom.ghl_inbound_events WHERE status IN ('pending','processing')) open_inbound_events,
    (SELECT count(*)::int FROM tanaghom.conversation_intelligence_proposals proposal WHERE proposal.organization_id=organization.id) proposals,
    (SELECT count(*)::int FROM tanaghom.conversation_supervisor_inbox inbox WHERE inbox.organization_id=organization.id AND inbox.state='awaiting_approval') supervisor_rows
  FROM tanaghom.organizations organization
  JOIN tanaghom.integration_connections connection ON connection.organization_id=organization.id AND connection.provider='ghl'
  JOIN tanaghom.organization_crm_policies policy ON policy.organization_id=organization.id
  JOIN tanaghom.organization_automation_policies automation ON automation.organization_id=organization.id
  CROSS JOIN tanaghom.automation_platform_controls control
  CROSS JOIN tanaghom.agent_workflow_registry registry
  WHERE organization.id=$1 AND control.provider='ghl' AND registry.code='conversation_intelligence_worker'`, [org.id])).rows[0];
  if (!row || row.organization_active || row.active_users !== 0 || row.integration_status !== "disconnected" ||
      !row.ciphertext_erased || !row.nonce_erased || !row.auth_tag_erased || !row.key_version_erased || !row.last_four_erased ||
      row.contact_sync_mode !== "manual" || row.conversation_processing_mode !== "paused" || !row.conversation_emergency_stop ||
      row.action_mode !== "manual" || row.proactive_message_mode !== "disabled" || !row.action_emergency_stop ||
      row.postiz_draft_mode !== "manual" || !row.platform_stop || row.runtime_state !== "imported_inactive" || row.trigger_state !== "disabled" ||
      row.connected_ghl !== 0 || row.open_conversation_jobs !== 0 || row.open_inbound_events !== 0 ||
      row.proposals !== 1 || row.supervisor_rows !== 1) {
    throw new Error("synthetic fixture or platform locks are not in the exact finalized state");
  }
  console.log(JSON.stringify({ organization_id: org.id, ...row, evidence_retained: true }));
}

async function quarantine() {
  const reason = decodeReason(encodedReason);
  await client.query("BEGIN");
  try {
    await client.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,reason=$1 WHERE provider='ghl'", [reason]);
    await client.query(`UPDATE tanaghom.agent_workflow_registry SET runtime_state='imported_inactive',trigger_state='disabled',
      runtime_verified_at=statement_timestamp(),runtime_evidence=$1 WHERE code='conversation_intelligence_worker'`, [`${canaryId}-failure-quarantined`]);
    const orgResult = await client.query("SELECT id FROM tanaghom.organizations WHERE slug=$1 FOR UPDATE", [identity.slug]);
    if (orgResult.rowCount === 1) {
      const orgId = orgResult.rows[0].id;
      await client.query(`UPDATE tanaghom.agent_jobs SET status='cancelled',finished_at=statement_timestamp(),
        error_code='synthetic_canary_quarantined',error_message='Controlled synthetic canary did not complete'
        WHERE job_type='conversation.ghl.inbound_event' AND input->>'organization_id'=$1::text AND status IN ('queued','running')`, [orgId]);
      await client.query(`UPDATE tanaghom.ghl_inbound_events SET status='dead_letter',processed_at=statement_timestamp(),
        last_error_code='synthetic_canary_quarantined',last_error_message='Controlled synthetic canary did not complete'
        WHERE organization_id=$1 AND status IN ('pending','processing')`, [orgId]);
      await client.query(`UPDATE tanaghom.integration_connections SET status='disconnected',credential_ciphertext=NULL,
        credential_nonce=NULL,credential_auth_tag=NULL,credential_key_version=NULL,secret_last_four=NULL,
        disconnected_at=coalesce(disconnected_at,statement_timestamp()),last_test_status=NULL,last_error_code='synthetic_canary_quarantined'
        WHERE organization_id=$1 AND provider='ghl'`, [orgId]);
      await client.query(`UPDATE tanaghom.organization_crm_policies SET contact_sync_mode='manual',
        conversation_processing_mode='paused',conversation_emergency_stop=true,
        conversation_emergency_reason='Synthetic canary failure quarantined',action_mode='manual',
        proactive_message_mode='disabled',action_emergency_stop=true WHERE organization_id=$1`, [orgId]);
      await client.query("UPDATE tanaghom.organization_automation_policies SET postiz_draft_mode='manual' WHERE organization_id=$1", [orgId]);
      await client.query("UPDATE tanaghom.app_users SET is_active=false WHERE organization_id=$1", [orgId]);
      await client.query("UPDATE tanaghom.organizations SET is_active=false WHERE id=$1", [orgId]);
      await client.query(`UPDATE tanaghom.agents SET status='idle',last_heartbeat_at=statement_timestamp()
        WHERE code='sales_crm' AND NOT EXISTS (SELECT 1 FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND status='running')`);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ platform_stop: true, synthetic_fixture_quarantined: orgResult.rowCount === 1, evidence_retained: true }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

try {
  if (action === "check-database") await checkDatabase();
  else if (action === "snapshot-controls") await snapshotControls();
  else if (action === "seed") await seed();
  else if (action === "assert-only-canary") await assertOnlyCanary();
  else if (action === "unlock") await unlock();
  else if (action === "restore-locks") await restoreLocks();
  else if (action === "verify-ready") await verifyReady();
  else if (action === "finalize") await finalize();
  else if (action === "verify-finalized") await verifyFinalized();
  else await quarantine();
} finally {
  await client.end();
}
