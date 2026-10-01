// Disposable PostgreSQL + local fake Slack/SMTP proof for alert delivery (#46/#55). No real provider is contacted.
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import pg from 'pg';
import { emailTransport, runDeliveryTick, slackTransport, smtpTransporter } from '../packages/agent-runtime/notification-delivery.mjs';

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error('DATABASE_TEST_URL is required');
const org = '10000000-0000-4000-8000-000000000001';
const owner = '00000000-0000-4000-8000-000000000001';
const slackTarget = 'https://hooks.slack.com/services/T000TEST/B000TEST/XXXXTESTSECRET';
const emailTarget = 'alerts@example.test';
const key = randomBytes(32);

function sh(args) {
  const result = spawnSync(process.execPath, args, { env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_MIGRATION_TARGET: '' }, stdio: 'inherit' });
  assert.equal(result.status, 0);
}
function encrypt(value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return { ciphertext: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]), nonce, tag: cipher.getAuthTag() };
}
function decrypt(row) {
  const decipher = createDecipheriv('aes-256-gcm', key, row.target_nonce);
  decipher.setAuthTag(row.target_auth_tag);
  return Buffer.concat([decipher.update(row.target_ciphertext), decipher.final()]).toString('utf8');
}

const slackBodies = [];
let slackCodes = [500];
const slack = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  slackBodies.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
  response.writeHead(slackCodes.shift() ?? 200).end('ok');
});
const mails = [];
const auths = [];
let smtpCodes = [451];
const smtp = net.createServer((socket) => {
  let buffer = '', data = false, message = '';
  socket.write('220 fake.test ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf('\r\n')) >= 0;) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      if (data) {
        if (line !== '.') { message += `${line}\n`; continue; }
        data = false;
        const code = smtpCodes.shift() ?? 250;
        if (code === 250) mails.push(message);
        socket.write(`${code} ${code === 250 ? 'queued' : 'try later'}\r\n`);
        continue;
      }
      const command = line.slice(0, 4).toUpperCase();
      if (command === 'EHLO' || command === 'HELO') socket.write('250-fake.test\r\n250 OK\r\n');
      else if (command === 'AUTH') { auths.push(line); socket.write('235 authenticated\r\n'); }
      else if (command === 'DATA') { data = true; message = ''; socket.write('354 end with .\r\n'); }
      else if (command === 'QUIT') socket.end('221 bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});

sh(['scripts/database.mjs', 'migrate']);
const admin = new pg.Pool({ connectionString: databaseUrl, max: 2 });
let api;
try {
  await admin.query(readFileSync('packages/database/seeds/staging.sql', 'utf8'));
  slack.listen(0, '127.0.0.1'); smtp.listen(0, '127.0.0.1');
  await Promise.all([once(slack, 'listening'), once(smtp, 'listening')]);
  const transports = {
    slack: slackTransport({ fetch, rewriteOrigin: (target) => `http://127.0.0.1:${slack.address().port}${new URL(target).pathname}` }),
    email: emailTransport({ transporter: smtpTransporter('smtp://alerts-user:test-only-password@127.0.0.1', { connect: () => net.connect(smtp.address().port, '127.0.0.1') }), from: 'tanaghom@example.test' }),
  };
  await admin.query("ALTER ROLE tanaghom_api LOGIN PASSWORD 'notification-delivery-test-only'");
  const apiUrl = new URL(databaseUrl); apiUrl.username = 'tanaghom_api'; apiUrl.password = 'notification-delivery-test-only';
  api = new pg.Pool({ connectionString: apiUrl.toString(), max: 2 });
  const tick = () => runDeliveryTick({ query: (sql, args) => api.query(sql, args), decrypt, transports });

  for (const [channel, target] of [['email', emailTarget], ['slack', slackTarget]]) {
    const value = encrypt(target);
    await admin.query(`INSERT INTO tanaghom.notification_destinations (organization_id,channel,label,target_ciphertext,target_nonce,
      target_auth_tag,target_key_version,target_last_four,minimum_severity,event_types,configured_by)
      VALUES ($1,$2,$3,$4,$5,$6,1,$7,'warning',ARRAY['dependency_cooldown','dead_letter']::text[],$8)`,
    [org, channel, `Test ${channel}`, value.ciphertext, value.nonce, value.tag, target.slice(-4), owner]);
  }
  await admin.query(`INSERT INTO tanaghom.conversation_dependency_cooldowns (organization_id,dependency,blocked_until,reason)
    VALUES ($1,'gemma',statement_timestamp()+interval '30 minutes','Disposable cooldown')`, [org]);

  let result = await tick();
  assert.deepEqual([result.enqueued, result.claimed, slackBodies.length, mails.length], [0, 0, 0, 0], 'locked control must not deliver');
  console.log('PASS default runtime_ready=false/emergency_stop=true enqueues and sends nothing');

  await admin.query("UPDATE tanaghom.notification_delivery_controls SET runtime_ready=true,emergency_stop=false,reason='Disposable delivery test'");
  result = await tick();
  assert.equal(result.enqueued, 2);
  assert.deepEqual(result.results.map((r) => [r.channel, r.state]).sort(), [['email', 'pending'], ['slack', 'pending']]);
  assert.doesNotMatch(JSON.stringify(result), /XXXXTESTSECRET|alerts@example/);
  result = await tick();
  assert.deepEqual([result.enqueued, result.claimed], [0, 0], 'dedupe and backoff must hold');
  console.log('PASS Slack 500 and SMTP 451 are retried with backoff; condition is deduplicated');

  await admin.query("UPDATE tanaghom.notification_deliveries SET next_attempt_at=statement_timestamp() WHERE status='pending'");
  result = await tick();
  assert.deepEqual(result.results.map((r) => [r.channel, r.state]).sort(), [['email', 'sent'], ['slack', 'sent']]);
  assert.equal(slackBodies.length, 2); assert.equal(mails.length, 1);
  assert.equal(slackBodies[1].path, '/services/T000TEST/B000TEST/XXXXTESTSECRET');
  assert.match(slackBodies[1].body.text, /\[WARNING\] Gemma or GHL cooldown/);
  assert.match(mails[0], /Subject: \[WARNING\] Gemma or GHL cooldown/);
  assert.match(mails[0], /To: alerts@example\.test/);
  assert.equal(auths.at(-1), `AUTH PLAIN ${Buffer.from('\0alerts-user\0test-only-password').toString('base64')}`);
  result = await tick();
  assert.deepEqual([result.enqueued, result.claimed, slackBodies.length, mails.length], [0, 0, 2, 1]);
  console.log('PASS one real email and one Slack message delivered to local fakes; no duplicate on later ticks');

  const destination = (await admin.query("SELECT id FROM tanaghom.notification_destinations WHERE channel='slack'")).rows[0].id;
  await admin.query(`INSERT INTO tanaghom.notification_deliveries (organization_id,destination_id,event_type,severity,dedupe_key,status,attempts,claimed_at)
    VALUES ($1,$2,'dead_letter','error','dead_letter:stale-claim','sending',1,statement_timestamp()-interval '10 minutes')`, [org, destination]);
  result = await tick();
  assert.equal(result.claimed, 0);
  assert.deepEqual((await admin.query("SELECT status,last_error_code FROM tanaghom.notification_deliveries WHERE dedupe_key='dead_letter:stale-claim'")).rows[0],
    { status: 'failed', last_error_code: 'outcome_unknown' });
  assert.equal(slackBodies.length, 2);
  console.log('PASS a stale claim with an unknown outcome is failed, never resent');

  await admin.query("DELETE FROM tanaghom.notification_deliveries WHERE destination_id=$1 AND event_type='dependency_cooldown'", [destination]);
  await admin.query(`INSERT INTO tanaghom.notification_deliveries (organization_id,destination_id,event_type,severity,dedupe_key,status,sent_at)
    SELECT $1,$2,'dead_letter','error','dead_letter:rate-'||n,'sent',statement_timestamp() FROM generate_series(1,10) n`, [org, destination]);
  result = await tick();
  assert.deepEqual([result.enqueued, slackBodies.length], [0, 2], 'rate limit must block an eleventh hourly delivery');
  console.log('PASS at most 10 new deliveries per destination per hour');

  await admin.query("UPDATE tanaghom.notification_delivery_controls SET emergency_stop=true,reason='Disposable delivery test stopped'");
  await admin.query(`INSERT INTO tanaghom.notification_deliveries (organization_id,destination_id,event_type,severity,dedupe_key)
    VALUES ($1,$2,'dead_letter','error','dead_letter:after-stop')`, [org, destination]);
  result = await tick();
  assert.deepEqual([result.enqueued, result.claimed, slackBodies.length], [0, 0, 2]);
  assert.equal((await admin.query("SELECT status FROM tanaghom.notification_deliveries WHERE dedupe_key='dead_letter:after-stop'")).rows[0].status, 'pending');
  console.log('PASS emergency stop halts claiming of already-queued deliveries');

  for (const role of ['tanaghom_readonly', 'tanaghom_n8n_worker', 'tanaghom_conversation_worker']) {
    const { rows: [privilege] } = await admin.query(`SELECT has_table_privilege($1,'tanaghom.notification_deliveries','SELECT,INSERT,UPDATE,DELETE') AS table_access,
      has_function_privilege($1,'tanaghom.claim_notification_deliveries(integer)','EXECUTE') AS claim`, [role]);
    assert.deepEqual(privilege, { table_access: false, claim: false }, role);
  }
  assert.equal((await admin.query("SELECT has_table_privilege('tanaghom_api','tanaghom.notification_delivery_controls','UPDATE') AS u")).rows[0].u, false);
  console.log('PASS only the API role can run delivery; it still cannot change the platform control');

  await assert.rejects(admin.query(readFileSync('packages/database/migrations/0036_notification_delivery_worker.down.sql', 'utf8')), /history exists/);
  await admin.query('ROLLBACK').catch(() => {});
  await admin.query('DELETE FROM tanaghom.notification_deliveries');
  await admin.query(readFileSync('packages/database/migrations/0036_notification_delivery_worker.down.sql', 'utf8'));
  assert.equal((await admin.query("SELECT to_regclass('tanaghom.notification_deliveries') AS t")).rows[0].t, null);
  await admin.query(readFileSync('packages/database/migrations/0036_notification_delivery_worker.up.sql', 'utf8'));
  console.log('PASS 0036 rollback refuses history, then down/up round-trips cleanly');
} finally {
  await admin.query("UPDATE tanaghom.notification_delivery_controls SET runtime_ready=false,emergency_stop=true,reason='Notification delivery is disabled until the runtime and destination are approved'").catch(() => {});
  await admin.query('ALTER ROLE tanaghom_api NOLOGIN PASSWORD NULL').catch(() => {});
  await api?.end(); await admin.end();
  slack.close(); smtp.close();
}
