#!/usr/bin/env node
// Live tenant-isolation proof. Runs the same predicates as authorize() against
// a disposable database, then rolls everything back.
import { randomUUID } from "node:crypto";

import pg from "pg";

const connectionString = process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_TEST_URL or DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 2 });
const client = await pool.connect();
const hash = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA==";

function uid() {
  return randomUUID();
}

try {
  await client.query("BEGIN");

  const orgA = uid();
  const orgB = uid();
  await client.query(
    "INSERT INTO tanaghom.organizations (id, slug, name, status) VALUES ($1, $2, 'Tenant A', 'trialing'), ($3, $4, 'Tenant B', 'trialing')",
    [orgA, `tenant-a-${orgA.slice(0, 8)}`, orgB, `tenant-b-${orgB.slice(0, 8)}`],
  );

  const userA = uid();
  const userB = uid();
  await client.query(
    `INSERT INTO tanaghom.users (id, email, password_hash, full_name)
     VALUES ($1, $2, $5, 'Owner A'), ($3, $4, $5, 'Owner B')`,
    [userA, `a-${userA.slice(0, 8)}@example.test`, userB, `b-${userB.slice(0, 8)}@example.test`, hash],
  );
  await client.query(
    `INSERT INTO tanaghom.memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
    [userA, orgA, userB, orgB],
  );
  const profileA = uid();
  const profileB = uid();
  await client.query(
    `INSERT INTO tanaghom.app_users (id, email, display_name, kind, role, auth_subject, organization_id, accepted_at)
     VALUES ($1, $5, 'Owner A', 'human', 'owner', $2, $3, now()),
            ($4, $6, 'Owner B', 'human', 'owner', $7, $8, now())`,
    [profileA, userA, orgA, profileB, `a-${userA.slice(0, 8)}@example.test`, `b-${userB.slice(0, 8)}@example.test`, userB, orgB],
  );

  const sessionA = uid();
  await client.query(
    `INSERT INTO tanaghom.sessions (id, token_hash, user_id, organization_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sessionA, `hash-${sessionA}`, userA, orgA],
  );

  const tenantQuery = `
    SELECT au.id, au.organization_id, au.display_name, au.role
      FROM tanaghom.app_users au
      JOIN tanaghom.memberships m
        ON m.user_id = au.auth_subject AND m.organization_id = au.organization_id AND m.is_active
      JOIN tanaghom.users u ON u.id = au.auth_subject AND u.disabled = false
      JOIN tanaghom.sessions s
        ON s.id = $3::uuid AND s.user_id = au.auth_subject AND s.organization_id = au.organization_id
       AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 minutes'
     WHERE au.auth_subject = $1::uuid AND au.organization_id = $2::uuid
       AND au.kind = 'human' AND au.is_active AND au.accepted_at IS NOT NULL`;

  const own = await client.query(tenantQuery, [userA, orgA, sessionA]);
  if (own.rows.length !== 1 || own.rows[0].id !== profileA) throw new Error("tenant A cannot read its own profile");

  const foreignByOrg = await client.query(tenantQuery, [userA, orgB, sessionA]);
  if (foreignByOrg.rows.length !== 0) throw new Error("tenant A read tenant B through an organization id swap");

  const foreignByUser = await client.query(tenantQuery, [userB, orgA, sessionA]);
  if (foreignByUser.rows.length !== 0) throw new Error("tenant A read tenant B through a user id swap");

  const crossMembership = await client.query(
    `SELECT 1 FROM tanaghom.memberships WHERE user_id = $1 AND organization_id = $2`,
    [userA, orgB],
  );
  if (crossMembership.rows.length !== 0) throw new Error("tenant A holds a membership in tenant B");

  const expiredSession = uid();
  await client.query(
    `INSERT INTO tanaghom.sessions (id, token_hash, user_id, organization_id, expires_at)
     VALUES ($1, $2, $3, $4, now() - interval '1 minute')`,
    [expiredSession, `hash-${expiredSession}`, userA, orgA],
  );
  const afterRevoke = await client.query(tenantQuery, [userA, orgA, expiredSession]);
  if (afterRevoke.rows.length !== 0) throw new Error("an expired session still authorizes");

  await client.query("ROLLBACK");
  console.log("TENANT_ISOLATION_OK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
