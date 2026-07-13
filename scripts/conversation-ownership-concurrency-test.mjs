import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_TEST_URL;
if (!connectionString) throw new Error("DATABASE_TEST_URL is required.");
const pool = new pg.Pool({ connectionString, max: 6, application_name: "phase5d-concurrency-test" });
const owner = "00000000-0000-4000-8000-000000000001";
const operator = "68000000-0000-4000-8000-000000000001";
const outsider = "68000000-0000-4000-8000-000000000011";

async function current() {
  const result = await pool.query(`SELECT * FROM tanaghom.conversations
    WHERE organization_id='10000000-0000-4000-8000-000000000001'
      AND provider_conversation_id='conversation-intelligence-1'`);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function transition({ action, actor, assignee = null, reason, version, command }) {
  return pool.query(`SELECT * FROM tanaghom.transition_supervised_conversation(
    $1,$2,$3,$4,$5,$6,$7)`, [(await current()).id, action, actor, assignee, reason, version, command]);
}

try {
  await pool.query(`UPDATE tanaghom.organization_crm_policies SET
    conversation_processing_mode='shadow',conversation_emergency_stop=false,
    conversation_emergency_reason='Disposable ownership concurrency test'
    WHERE organization_id='10000000-0000-4000-8000-000000000001'`);
  await pool.query(`UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,
    reason='Disposable ownership concurrency test' WHERE provider='ghl'`);

  const before = await current();
  const commands = [randomUUID(), randomUUID()];
  const contenders = await Promise.allSettled([
    transition({ action: "takeover", actor: owner, reason: "Owner concurrent takeover", version: before.conversation_version, command: commands[0] }),
    transition({ action: "takeover", actor: operator, reason: "Operator concurrent takeover", version: before.conversation_version, command: commands[1] }),
  ]);
  assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1, "exactly one simultaneous takeover must win");
  assert.equal(contenders.filter((result) => result.status === "rejected").length, 1, "one simultaneous takeover must fail stale");
  let owned = await current();
  assert.equal(owned.state, "human_owned");
  assert.equal(owned.reply_authority, "human");
  const winningIndex = contenders.findIndex((result) => result.status === "fulfilled");
  const winningCommand = commands[winningIndex];
  const winningActor = winningIndex === 0 ? owner : operator;

  const duplicate = await transition({ action: "takeover", actor: winningActor,
    reason: "Duplicate click returns the original result", version: before.conversation_version, command: winningCommand });
  assert.equal(duplicate.rows[0].conversation_version, owned.conversation_version);
  const duplicateCount = await pool.query(`SELECT count(*)::int AS count FROM tanaghom.conversation_ownership_history WHERE command_id=$1`, [winningCommand]);
  assert.equal(duplicateCount.rows[0].count, 1, "duplicate command must have one immutable history row");

  await assert.rejects(transition({ action: "assign", actor: owner, assignee: outsider,
    reason: "Cross-organization assignment must fail", version: owned.conversation_version, command: randomUUID() }), /same-organization/);

  const draftCommand = randomUUID();
  const draft = await pool.query(`SELECT tanaghom.create_conversation_human_reply_draft($1,$2,$3,$4,$5,$6) AS id`,
    [owned.id, winningActor, owned.ownership_epoch, "A supervised reply awaiting Phase 5E delivery.", "en", draftCommand]);
  const duplicateDraft = await pool.query(`SELECT tanaghom.create_conversation_human_reply_draft($1,$2,$3,$4,$5,$6) AS id`,
    [owned.id, winningActor, owned.ownership_epoch, "A supervised reply awaiting Phase 5E delivery.", "en", draftCommand]);
  assert.equal(draft.rows[0].id, duplicateDraft.rows[0].id);

  owned = await current();
  await transition({ action: "resume_ai", actor: owner, reason: "Explicit supervised return to AI",
    version: owned.conversation_version, command: randomUUID() });
  let aiOwned = await current();
  const leaseCommand = randomUUID();
  const lease = await pool.query(`SELECT * FROM tanaghom.claim_conversation_ai_lease($1,$2,30,$3)`,
    [aiOwned.id, aiOwned.ownership_epoch, leaseCommand]);
  const duplicateLease = await pool.query(`SELECT * FROM tanaghom.claim_conversation_ai_lease($1,$2,30,$3)`,
    [aiOwned.id, aiOwned.ownership_epoch, leaseCommand]);
  assert.equal(lease.rows[0].lease_token, duplicateLease.rows[0].lease_token, "reconnect must recover the same lease receipt");
  await pool.query(`SELECT tanaghom.assert_conversation_ai_reply_authority($1,$2,$3)`,
    [aiOwned.id, lease.rows[0].lease_token, aiOwned.ownership_epoch]);

  aiOwned = await current();
  await transition({ action: "takeover", actor: owner, reason: "Human takeover invalidates queued AI dispatch",
    version: aiOwned.conversation_version, command: randomUUID() });
  await assert.rejects(pool.query(`SELECT tanaghom.assert_conversation_ai_reply_authority($1,$2,$3)`,
    [aiOwned.id, lease.rows[0].lease_token, aiOwned.ownership_epoch]), /authority lost/);

  let humanOwned = await current();
  await transition({ action: "resume_ai", actor: owner, reason: "Prepare lost lease recovery",
    version: humanOwned.conversation_version, command: randomUUID() });
  aiOwned = await current();
  const expiring = await pool.query(`SELECT * FROM tanaghom.claim_conversation_ai_lease($1,$2,15,$3)`,
    [aiOwned.id, aiOwned.ownership_epoch, randomUUID()]);
  await pool.query(`UPDATE tanaghom.conversations SET lease_expires_at=statement_timestamp()-interval '1 second' WHERE id=$1`, [aiOwned.id]);
  await assert.rejects(pool.query(`SELECT tanaghom.assert_conversation_ai_reply_authority($1,$2,$3)`,
    [aiOwned.id, expiring.rows[0].lease_token, aiOwned.ownership_epoch]), /authority lost/);
  const recovered = await pool.query(`SELECT * FROM tanaghom.claim_conversation_ai_lease($1,$2,15,$3)`,
    [aiOwned.id, aiOwned.ownership_epoch, randomUUID()]);
  assert.notEqual(recovered.rows[0].lease_token, expiring.rows[0].lease_token, "expired lease must rotate on recovery");

  const affected = await pool.query(`SELECT tanaghom.set_organization_conversation_emergency_stop(true,$1,$2,$3) AS affected`,
    ["Disposable organization-wide emergency stop", owner, randomUUID()]);
  assert.ok(affected.rows[0].affected >= 1);
  const paused = await current();
  assert.equal(paused.state, "paused");
  assert.equal(paused.reply_authority, "none");
  await assert.rejects(pool.query(`SELECT tanaghom.assert_conversation_ai_reply_authority($1,$2,$3)`,
    [paused.id, recovered.rows[0].lease_token, aiOwned.ownership_epoch]), /authority lost/);
  await pool.query(`SELECT tanaghom.set_organization_conversation_emergency_stop(false,$1,$2,$3)`,
    ["Emergency cleared; explicit conversation resume still required", owner, randomUUID()]);
  assert.equal((await current()).state, "paused", "clearing emergency must not silently restore AI authority");

  const badHistory = await pool.query(`SELECT count(*)::int AS count FROM tanaghom.conversation_ownership_history
    WHERE conversation_id=$1 AND (reason IS NULL OR previous_state IS NULL OR new_state IS NULL
      OR occurred_at IS NULL OR result_version IS NULL) AND action<>'created'`, [paused.id]);
  assert.equal(badHistory.rows[0].count, 0, "every transition must preserve actor-independent state evidence");
  const operations = await pool.query(`SELECT count(*)::int AS count FROM tanaghom.external_operations
    WHERE provider='ghl' AND operation_type LIKE '%message%'`);
  assert.equal(operations.rows[0].count, 0, "Phase 5D must not create provider message operations");
  await pool.query(`DELETE FROM tanaghom.app_users WHERE organization_id='68000000-0000-4000-8000-000000000010'`);
  await pool.query(`DELETE FROM tanaghom.organizations WHERE id='68000000-0000-4000-8000-000000000010'`);
  console.log("PASS: simultaneous takeover, duplicate clicks, assignment isolation, lost leases, reconnects, and dispatch-time authority checks enforced.");
} finally {
  await pool.end();
}
