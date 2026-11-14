import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_CONCURRENT_SCRYPT,
  MAX_SCRYPT_QUEUE,
  createScryptLimiter,
  scryptLimiterStats,
} from "../deployment/dashboard-demo/auth/passwords.mjs";
import { authPoolMax } from "../deployment/dashboard-demo/auth/store.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("scrypt limiter caps concurrent work and rejects queue overflow", async () => {
  const limiter = createScryptLimiter({ concurrency: 2, maxQueue: 1 });
  const gates = [];
  const started = [];
  const tasks = [1, 2, 3].map((id) => limiter.run(() => {
    started.push(id);
    const gate = deferred();
    gates.push(gate);
    return gate.promise;
  }));

  await tick();
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(limiter.stats(), { inFlight: 2, queued: 1, concurrency: 2, maxQueue: 1 });

  await assert.rejects(
    limiter.run(async () => {}),
    (error) => {
      assert.equal(error.code, "auth_busy");
      assert.equal(error.status, 503);
      return true;
    },
  );

  gates[0].resolve();
  await tick();
  assert.deepEqual(started, [1, 2, 3]);
  gates[1].resolve();
  gates[2].resolve();
  await Promise.all(tasks);
  assert.deepEqual(limiter.stats(), { inFlight: 0, queued: 0, concurrency: 2, maxQueue: 1 });
  assert.equal(MAX_CONCURRENT_SCRYPT, 4);
  assert.equal(MAX_SCRYPT_QUEUE, 32);
  assert.deepEqual(scryptLimiterStats().concurrency, MAX_CONCURRENT_SCRYPT);
});

test("pool sizes are bounded and fall back to the reviewed defaults", () => {
  assert.equal(authPoolMax({}), 15);
  assert.equal(authPoolMax({ AUTH_DB_POOL_MAX: "4" }), 4);
  assert.equal(authPoolMax({ AUTH_DB_POOL_MAX: "40" }), 40);
  assert.equal(authPoolMax({ AUTH_DB_POOL_MAX: "1" }), 4);
  assert.equal(authPoolMax({ AUTH_DB_POOL_MAX: "999" }), 40);
  assert.equal(authPoolMax({ AUTH_DB_POOL_MAX: "not-a-number" }), 15);
});

test("the dashboard session CTE throttles touches and keeps authorization joins atomic", async () => {
  const authorization = await read("apps/dashboard/lib/server/authorization.ts");
  assert.match(authorization, /WITH valid_session AS/);
  assert.match(authorization, /last_seen_at <= now\(\) - interval '60 seconds'/);
  assert.match(authorization, /last_seen_at > now\(\) - interval '30 minutes'/);
  assert.match(authorization, /authorized_member AS/);
  assert.match(authorization, /JOIN tanaghom\.memberships m/);
  assert.match(authorization, /m\.is_active/);
  assert.match(authorization, /u\.disabled = false/);
  assert.match(authorization, /LEFT JOIN authorized_member am ON true/);
  assert.match(authorization, /FROM valid_session vs/);
  assert.match(authorization, /session\.rows\.length === 0/);
  assert.match(authorization, /User is not authorized/);
});

test("pool, scrypt, compose, server and backup contracts are wired", async () => {
  const database = await read("apps/dashboard/lib/server/database.ts");
  assert.match(database, /PG_POOL_MAX/);
  assert.match(database, /DATABASE_POOL_MAX/);
  assert.match(database, /return 25/);
  assert.match(database, /Math\.min\(80, Math\.max\(5, parsed\)\)/);
  assert.match(database, /idleTimeoutMillis: 30_000/);
  assert.match(database, /connectionTimeoutMillis: 5_000/);

  const compose = await read("deployment/dashboard-demo/compose.yml");
  assert.match(compose, /PG_POOL_MAX: \$\{PG_POOL_MAX:-25\}/);
  assert.match(compose, /AUTH_DB_POOL_MAX: \$\{AUTH_DB_POOL_MAX:-15\}/);
  assert.match(compose, /AUTH_SCRYPT_CONCURRENCY: \$\{AUTH_SCRYPT_CONCURRENCY:-4\}/);
  assert.match(compose, /AUTH_SCRYPT_MAX_QUEUE: \$\{AUTH_SCRYPT_MAX_QUEUE:-32\}/);
  const authSection = compose.slice(compose.indexOf("\n  auth:"), compose.indexOf("\n  storage:"));
  assert.match(authSection, /cpus: 1\.0/);
  assert.match(authSection, /mem_limit: 512m/);

  const server = await read("deployment/dashboard-demo/auth/server.mjs");
  assert.match(server, /error\?\.code === "auth_busy"/);
  assert.match(server, /Retry-After": "2"/);

  const backup = await read("deployment/dashboard-demo/scripts/demo-backup.sh");
  const backupLib = await read("deployment/dashboard-demo/scripts/demo-lifecycle-lib.sh");
  assert.match(backup, /TANAGHOM_BACKUP_MIN_FREE_MB/);
  assert.match(backupLib, /df -Pk/);
  assert.match(backup, /previous_mb \* 2/);
  assert.match(backup, /insufficient free disk space for backup/);
  const scheduled = await read("deployment/dashboard-demo/scripts/scheduled-backup.sh");
  assert.match(scheduled, /BACKUP_DISK_STATUS avail_mb=/);
  const example = await read("deployment/dashboard-demo/.env.example");
  assert.match(example, /TANAGHOM_BACKUP_MIN_FREE_MB=2048/);
  assert.match(example, /TANAGHOM_BACKUP_RETENTION=7/);
});
