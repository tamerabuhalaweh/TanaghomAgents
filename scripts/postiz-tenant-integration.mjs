#!/usr/bin/env node
// PostgreSQL proof for WS4's conflict-safe Postiz organization provisioning and
// tenant-scoped publishing-channel synchronization. It uses disposable temp
// tables plus a rolled-back Tanaghom transaction, so no Postiz container is
// needed in CI.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";

const connectionString = process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_TEST_URL or DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 2 });
const client = await pool.connect();
const key = () => randomBytes(32).toString("hex");

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE "Organization" (
      id text PRIMARY KEY,
      name text NOT NULL,
      description text,
      "apiKey" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "allowTrial" boolean NOT NULL DEFAULT false,
      "isTrailing" boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP`);

  const existingId = `tenant-${randomUUID()}`;
  const existingKey = key();
  await client.query(
    `INSERT INTO "Organization" (id, name, "apiKey") VALUES ($1, 'Existing tenant', $2)`,
    [existingId, existingKey],
  );

  const discardedCandidate = key();
  const conflict = await client.query(
    `INSERT INTO "Organization"
       (id, name, description, "apiKey", "createdAt", "updatedAt", "allowTrial", "isTrailing")
     VALUES ($1, 'Tanaghom Existing', 'existing', $2, now(), now(), false, false)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, "apiKey"`,
    [existingId, discardedCandidate],
  );
  assert.equal(conflict.rowCount, 0, "a concurrent/existing organization must return no candidate row");
  const authoritative = await client.query(
    `SELECT "apiKey" FROM "Organization" WHERE id = $1`,
    [existingId],
  );
  assert.equal(authoritative.rows[0].apiKey, existingKey, "the existing authoritative key must be used");
  assert.notEqual(authoritative.rows[0].apiKey, discardedCandidate, "the discarded candidate must never win");

  const newId = `tenant-${randomUUID()}`;
  const createdKey = key();
  const created = await client.query(
    `INSERT INTO "Organization"
       (id, name, description, "apiKey", "createdAt", "updatedAt", "allowTrial", "isTrailing")
     VALUES ($1, 'Tanaghom New', 'new', $2, now(), now(), false, false)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, "apiKey"`,
    [newId, createdKey],
  );
  assert.equal(created.rows[0].apiKey, createdKey);

  const orgA = randomUUID();
  const orgB = randomUUID();
  await client.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, status)
     VALUES ($1, $2, 'WS4 A', 'trialing'), ($3, $4, 'WS4 B', 'trialing')`,
    [orgA, `ws4-a-${orgA.slice(0, 8)}`, orgB, `ws4-b-${orgB.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO tanaghom.publishing_channels
       (organization_id, provider, channel, provider_integration_id, provider_settings)
     VALUES ($1, 'postiz', 'instagram', $2, '{"__type":"instagram"}'::jsonb),
            ($3, 'postiz', 'instagram', $4, '{"__type":"instagram"}'::jsonb)`,
    [orgA, `postiz-${orgA}`, orgB, `postiz-${orgB}`],
  );
  await client.query(
    `DELETE FROM tanaghom.publishing_channels WHERE organization_id = $1 AND provider = 'postiz'`,
    [orgA],
  );
  const remaining = await client.query(
    `SELECT organization_id FROM tanaghom.publishing_channels WHERE provider = 'postiz' AND organization_id = ANY($1::uuid[])`,
    [[orgA, orgB]],
  );
  assert.deepEqual(remaining.rows.map((row) => row.organization_id), [orgB],
    "channel synchronization must delete only the caller's tenant mappings");

  await client.query("ROLLBACK");
  console.log("POSTIZ_TENANT_INTEGRATION_OK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
