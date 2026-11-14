#!/usr/bin/env node
// PostgreSQL proof for the dashboard's one-round-trip session CTE. It uses a
// disposable transaction and the same predicates as requireTenant().
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

const connectionString = process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_TEST_URL or DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 2 });
const client = await pool.connect();
const uid = () => randomUUID();

const sessionCte = `
  WITH valid_session AS (
    SELECT s.id, s.last_seen_at
      FROM tanaghom.sessions s
     WHERE s.id = $1::uuid
       AND s.user_id = $2::uuid
       AND s.organization_id = $3::uuid
       AND s.expires_at > now()
       AND s.last_seen_at > now() - interval '30 minutes'
  ),
  touched_session AS (
    UPDATE tanaghom.sessions
       SET last_seen_at = now()
     WHERE id = (SELECT id FROM valid_session WHERE last_seen_at <= now() - interval '60 seconds')
     RETURNING id
  ),
  authorized_member AS (
    SELECT au.id, au.organization_id, au.display_name, au.role
      FROM tanaghom.app_users au
      JOIN tanaghom.memberships m
        ON m.user_id = au.auth_subject
       AND m.organization_id = au.organization_id
       AND m.is_active
      JOIN tanaghom.users u
        ON u.id = au.auth_subject
       AND u.disabled = false
     WHERE au.auth_subject = $2::uuid
       AND au.organization_id = $3::uuid
       AND au.kind = 'human'
       AND au.is_active = true
       AND au.accepted_at IS NOT NULL
  )
  SELECT vs.id AS session_id, am.id, am.organization_id, am.display_name, am.role
    FROM valid_session vs
    LEFT JOIN authorized_member am ON true`;

function statusFor(rows) {
  if (rows.length === 0) return 401;
  if (!rows[0].id) return 403;
  return 200;
}

async function authorize(sessionId, userId, organizationId) {
  return client.query(sessionCte, [sessionId, userId, organizationId]);
}

async function setLastSeen(sessionId, expression) {
  await client.query(`UPDATE tanaghom.sessions SET last_seen_at = ${expression} WHERE id = $1`, [sessionId]);
}

try {
  await client.query("BEGIN");
  const organizationId = uid();
  const userId = uid();
  const profileId = uid();
  const sessionId = uid();
  const email = `session-${userId.slice(0, 8)}@example.test`;

  await client.query(
    "INSERT INTO tanaghom.organizations (id, slug, name, status) VALUES ($1, $2, 'Session Test', 'trialing')",
    [organizationId, `session-${organizationId.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO tanaghom.users (id, email, password_hash, full_name)
     VALUES ($1, $2, 'scrypt$32768$8$1$c2FsdA==$aGFzaA==', 'Session User')`,
    [userId, email],
  );
  await client.query(
    `INSERT INTO tanaghom.app_users
       (id, email, display_name, kind, role, auth_subject, organization_id, accepted_at)
     VALUES ($1, $2, 'Session User', 'human', 'owner', $3, $4, now())`,
    [profileId, email, userId, organizationId],
  );
  await client.query(
    "INSERT INTO tanaghom.memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')",
    [userId, organizationId],
  );
  await client.query(
    `INSERT INTO tanaghom.sessions
       (id, token_hash, user_id, organization_id, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, clock_timestamp(), now() + interval '1 hour')`,
    [sessionId, `session-${sessionId}`, userId, organizationId],
  );

  const first = await authorize(sessionId, userId, organizationId);
  assert.equal(statusFor(first.rows), 200);
  assert.equal(first.rows[0].id, profileId);
  const before = await client.query("SELECT last_seen_at FROM tanaghom.sessions WHERE id = $1", [sessionId]);
  const second = await authorize(sessionId, userId, organizationId);
  assert.equal(statusFor(second.rows), 200);
  const after = await client.query("SELECT last_seen_at FROM tanaghom.sessions WHERE id = $1", [sessionId]);
  assert.equal(after.rows[0].last_seen_at.getTime(), before.rows[0].last_seen_at.getTime(),
    "two requests within 60 seconds must not write last_seen_at");

  await setLastSeen(sessionId, "now() - interval '2 minutes'");
  const stale = await authorize(sessionId, userId, organizationId);
  assert.equal(statusFor(stale.rows), 200);
  const refreshed = await client.query(
    "SELECT last_seen_at > now() - interval '5 seconds' AS fresh FROM tanaghom.sessions WHERE id = $1",
    [sessionId],
  );
  assert.equal(refreshed.rows[0].fresh, true, "a two-minute-old session must be touched");

  await setLastSeen(sessionId, "now() - interval '31 minutes'");
  const idle = await authorize(sessionId, userId, organizationId);
  assert.equal(statusFor(idle.rows), 401, "a session idle for 31 minutes must be rejected");

  await setLastSeen(sessionId, "clock_timestamp()");
  await client.query("UPDATE tanaghom.memberships SET is_active = false WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  const inertMembership = await authorize(sessionId, userId, organizationId);
  assert.equal(inertMembership.rows.length, 1);
  assert.equal(statusFor(inertMembership.rows), 403, "a deactivated membership must not authorize");

  await client.query("UPDATE tanaghom.memberships SET is_active = true WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  await client.query("UPDATE tanaghom.users SET disabled = true WHERE id = $1", [userId]);
  const disabledUser = await authorize(sessionId, userId, organizationId);
  assert.equal(disabledUser.rows.length, 1);
  assert.equal(statusFor(disabledUser.rows), 403, "a disabled user must not authorize");

  await client.query("ROLLBACK");
  console.log("SESSION_TOUCH_INTEGRATION_OK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
