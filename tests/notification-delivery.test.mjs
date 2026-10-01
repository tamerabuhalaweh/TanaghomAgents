import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { alertMessage, emailTransport, runDeliveryTick, slackTransport, smtpTransporter } from '../packages/agent-runtime/notification-delivery.mjs';

const webhook = 'https://hooks.slack.com/services/T000TEST/B000TEST/XXXXSECRET';
const message = alertMessage({ event_type: 'indeterminate_action', severity: 'critical', organization_name: 'Fictional Academy' });

test('alert copy names severity, event and organization without targets or automated-action claims', () => {
  assert.equal(message.subject, '[CRITICAL] Uncertain provider action - Fictional Academy');
  assert.match(message.text, /took no automated action/);
});

test('Slack transport classifies success, retryable, permanent and uncertain outcomes', async () => {
  let codes = [200, 429, 503, 400];
  const server = createServer((request, response) => {
    response.writeHead(codes.shift()).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = slackTransport({ fetch, rewriteOrigin: (target) => origin + new URL(target).pathname });
  try {
    assert.deepEqual(await send(webhook, message), { sent: true, status: 200, error: null, retryable: false });
    assert.equal((await send(webhook, message)).retryable, true);
    assert.equal((await send(webhook, message)).retryable, true);
    assert.deepEqual(await send(webhook, message), { sent: false, status: 400, error: 'slack_http_400', retryable: false });
    assert.equal((await send('https://evil.example/services/a/b/c', message)).error, 'slack_webhook_invalid');
    const closed = createServer(); closed.listen(0, '127.0.0.1'); await once(closed, 'listening');
    const closedPort = closed.address().port; closed.close(); await once(closed, 'close');
    const refused = slackTransport({ fetch, rewriteOrigin: () => `http://127.0.0.1:${closedPort}/x` });
    assert.deepEqual(await refused(webhook, message), { sent: false, status: null, error: 'slack_unreachable', retryable: true });
  } finally { server.closeAllConnections(); server.close(); }
});

test('email transport retries only transient SMTP and connection failures', async () => {
  const failing = (error) => emailTransport({ from: 'a@example.test', transporter: { sendMail: async () => { throw error; } } });
  const ok = emailTransport({ from: 'a@example.test', transporter: { sendMail: async (mail) => { assert.equal(mail.to, 'ops@example.test'); } } });
  assert.equal((await ok('ops@example.test', message)).sent, true);
  assert.equal((await failing({ responseCode: 451 })('ops@example.test', message)).retryable, true);
  assert.equal((await failing({ responseCode: 550 })('ops@example.test', message)).retryable, false);
  assert.equal((await failing({ code: 'ECONNECTION' })('ops@example.test', message)).retryable, true);
  assert.deepEqual(await failing({ code: 'ETIMEDOUT' })('ops@example.test', message), { sent: false, status: null, error: 'outcome_unknown', retryable: false });
});

test('a tick records every claimed outcome and fails closed on decryption or unknown channel', async () => {
  const calls = [];
  const rows = [
    { delivery_id: 'd1', channel: 'slack', event_type: 'dead_letter', severity: 'error', organization_name: 'Org' },
    { delivery_id: 'd2', channel: 'whatsapp', event_type: 'dead_letter', severity: 'error', organization_name: 'Org' },
    { delivery_id: 'd3', channel: 'email', event_type: 'dead_letter', severity: 'error', organization_name: 'Org', broken: true },
  ];
  const query = async (sql, args) => {
    calls.push([sql.match(/tanaghom\.(\w+)/)[1], args]);
    if (sql.includes('enqueue')) return { rows: [{ count: 3 }] };
    if (sql.includes('claim')) return { rows };
    return { rows: [{ state: args[1] ? 'sent' : 'failed' }] };
  };
  const result = await runDeliveryTick({ query, decrypt: (row) => { if (row.broken) throw new Error('x'); return webhook; },
    transports: { slack: async () => ({ sent: true, status: 200, error: null, retryable: false }) } });
  assert.deepEqual(result.results.map((r) => [r.delivery_id, r.state, r.error]),
    [['d1', 'sent', null], ['d2', 'failed', 'channel_unsupported'], ['d3', 'failed', 'destination_decryption_failed']]);
  assert.equal(calls.filter(([name]) => name === 'complete_notification_delivery').length, 3);
  assert.doesNotMatch(JSON.stringify(result), /XXXXSECRET/);
});

test('delivery route is off by default, worker-authenticated and never exposes targets', () => {
  const route = readFileSync('apps/dashboard/app/api/internal/notifications/deliver/route.ts', 'utf8');
  assert.match(route, /NOTIFICATION_DELIVERY_ENABLED !== "true"/);
  assert.match(route, /configured\.length < 32/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /smtpUrl\?\.startsWith\("smtps:\/\/"\)/);
  assert.match(route, /smtpTransporter\(smtpUrl\)/);
  assert.doesNotMatch(route, /console\.|target_last_four/);
  const env = readFileSync('.env.example', 'utf8');
  assert.match(env, /NOTIFICATION_DELIVERY_ENABLED=false/);
  const up = readFileSync('packages/database/migrations/0036_notification_delivery_worker.up.sql', 'utf8');
  assert.match(up, /IF NOT tanaghom\.notification_delivery_active\(\) THEN RETURN/);
  assert.match(up, /ON CONFLICT \(destination_id, dedupe_key\) DO NOTHING/);
  assert.match(up, /'outcome_unknown'/);
  assert.doesNotMatch(up, /UPDATE tanaghom\.notification_delivery_controls/);
  const down = readFileSync('packages/database/migrations/0036_notification_delivery_worker.down.sql', 'utf8');
  assert.match(down, /history exists/);
});

test('built-in SMTP client requires smtps in production, dot-stuffs the body and blocks header injection', async () => {
  assert.throws(() => smtpTransporter('smtp://host.example'), /smtps_required/);
  let received = '';
  const server = net.createServer((socket) => {
    socket.write('220 fake\r\n');
    let buffer = '', data = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\r\n')) >= 0;) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (data) { if (line === '.') { data = false; socket.write('250 queued\r\n'); } else received += `${line}\n`; continue; }
        if (/^DATA/.test(line)) { data = true; socket.write('354 go\r\n'); }
        else if (/^QUIT/.test(line)) socket.end('221 bye\r\n');
        else if (/^RCPT/.test(line) && line.includes('reject')) socket.write('550 no such user\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const connect = () => net.connect(server.address().port, '127.0.0.1');
  try {
    const send = emailTransport({ transporter: smtpTransporter('smtp://127.0.0.1', { connect }), from: 'a@example.test' });
    assert.equal((await send('ops@example.test', { subject: 'Alert\r\nBcc: victim@example.test', text: 'line one\n.hidden\nend' })).sent, true);
    assert.match(received, /^Subject: Alert Bcc: victim@example\.test$/m);
    assert.doesNotMatch(received, /^Bcc:/m);
    assert.match(received, /^\.\.hidden$/m);
    assert.deepEqual(await send('reject@example.test', message), { sent: false, status: 550, error: 'smtp_permanent_failure', retryable: false });
  } finally { server.close(); }
  const closed = net.createServer(); closed.listen(0, '127.0.0.1'); await once(closed, 'listening');
  const port = closed.address().port; closed.close(); await once(closed, 'close');
  const refused = emailTransport({ transporter: smtpTransporter('smtp://127.0.0.1', { connect: () => net.connect(port, '127.0.0.1') }), from: 'a@example.test' });
  assert.deepEqual(await refused('ops@example.test', message), { sent: false, status: null, error: 'smtp_unreachable', retryable: true });
});
