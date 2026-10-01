import net from 'node:net';
import tls from 'node:tls';

// Alert delivery for configured email/Slack destinations. Off unless the dashboard route is enabled
// and the database control is runtime_ready AND NOT emergency_stop. Targets are never logged.
const labels = {
  queue_age: 'Queue age warning',
  interactive_backlog: 'Interactive backlog',
  dependency_cooldown: 'Gemma or GHL cooldown',
  worker_unready: 'Worker unavailable',
  dead_letter: 'Dead-letter event',
  indeterminate_action: 'Uncertain provider action',
  database_unavailable: 'Database unavailable',
};
const details = {
  queue_age: 'The oldest pending conversation event is older than the configured warning age.',
  interactive_backlog: 'Interactive conversation work has reached the configured backlog threshold.',
  dependency_cooldown: 'Gemma or GoHighLevel is in a protective cooldown; dependent work is paused.',
  dead_letter: 'At least one event exhausted its bounded retries and needs human review.',
  indeterminate_action: 'A provider action has an unknown outcome; automation is blocked until a human reconciles it.',
};
const retryableNetwork = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET']);
const slackWebhook = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]{3,}\/[A-Za-z0-9]{3,}\/[A-Za-z0-9]{3,}$/;

export function alertMessage(row) {
  const subject = `[${row.severity.toUpperCase()}] ${labels[row.event_type]} - ${row.organization_name}`;
  const text = `${subject}\n${details[row.event_type] || 'Review the Tanaghom System page.'}\n`
    + 'Open Tanaghom > System to review. This alert took no automated action.';
  return { subject, text };
}

export function slackTransport({ fetch, rewriteOrigin = null }) {
  return async (target, message) => {
    if (!slackWebhook.test(target)) return { sent: false, status: null, error: 'slack_webhook_invalid', retryable: false };
    const url = rewriteOrigin ? rewriteOrigin(target) : target;
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message.text }),
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      return response.ok ? { sent: true, status: response.status, error: null, retryable: false }
        : { sent: false, status: response.status, error: `slack_http_${response.status}`, retryable: response.status === 429 || response.status >= 500 };
    } catch (error) {
      const code = error?.cause?.code;
      // A timeout may have reached Slack: never resend an uncertain alert.
      return retryableNetwork.has(code) ? { sent: false, status: null, error: 'slack_unreachable', retryable: true }
        : { sent: false, status: null, error: 'outcome_unknown', retryable: false };
    }
  };
}

const headerSafe = (value) => String(value).replace(/[\r\n]+/g, ' ').slice(0, 300);
const smtpError = (responseCode, code) => Object.assign(new Error('smtp_failed'), { responseCode, code });

// Minimal SMTP submission client (implicit TLS by default). No dependency; one message per connection.
export function smtpTransporter(url, { connect = null, timeoutMs = 15_000 } = {}) {
  const parsed = new URL(url);
  if (!connect && parsed.protocol !== 'smtps:') throw new Error('smtps_required');
  const host = parsed.hostname;
  const port = Number(parsed.port || 465);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const open = connect || (() => tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2' }));
  return {
    sendMail: ({ from, to, subject, text }) => new Promise((resolve, reject) => {
      const socket = open();
      let buffer = '';
      let step = 0;
      const date = new Date().toUTCString();
      const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      const data = `From: ${headerSafe(from)}\r\nTo: ${headerSafe(to)}\r\nSubject: ${headerSafe(subject)}\r\nDate: ${date}\r\n`
        + `MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n.`;
      const script = [
        ['EHLO tanaghom', 250],
        ...(user ? [[`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString('base64')}`, 235]] : []),
        [`MAIL FROM:<${headerSafe(from)}>`, 250], [`RCPT TO:<${headerSafe(to)}>`, 250], ['DATA', 354], [data, 250], ['QUIT', 221],
      ];
      let settled = false;
      const fail = (error) => { if (settled) return; settled = true; socket.destroy(); reject(error); };
      // A close before the message body was sent is safe to retry; after it the outcome is unknown.
      socket.on('close', () => fail(smtpError(undefined, step < script.length - 1 ? 'ECONNECTION' : 'EUNKNOWN')));
      socket.setTimeout(timeoutMs, () => fail(smtpError(undefined, 'ETIMEDOUT')));
      socket.on('error', (error) => fail(smtpError(undefined, error.code === 'ECONNREFUSED' ? 'ECONNECTION' : error.code)));
      socket.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\r\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (/^\d{3}-/.test(line)) continue;
          const code = Number(line.slice(0, 3));
          const expected = step === 0 ? 220 : script[step - 1][1];
          if (code !== expected) return fail(smtpError(code));
          if (step === script.length) { settled = true; socket.end(); return resolve({ accepted: [to] }); }
          socket.write(`${script[step][0]}\r\n`);
          step += 1;
        }
      });
    }),
  };
}

export function emailTransport({ transporter, from }) {
  return async (target, message) => {
    try {
      await transporter.sendMail({ from, to: target, subject: message.subject, text: message.text });
      return { sent: true, status: 250, error: null, retryable: false };
    } catch (error) {
      const code = Number(error?.responseCode);
      if (code >= 400 && code < 500) return { sent: false, status: code, error: 'smtp_transient_failure', retryable: true };
      if (code >= 500 && code < 600) return { sent: false, status: code, error: 'smtp_permanent_failure', retryable: false };
      return retryableNetwork.has(error?.code) || error?.code === 'ECONNECTION'
        ? { sent: false, status: null, error: 'smtp_unreachable', retryable: true }
        : { sent: false, status: null, error: 'outcome_unknown', retryable: false };
    }
  };
}

export async function runDeliveryTick({ query, decrypt, transports, limit = 10 }) {
  const enqueued = (await query('SELECT tanaghom.enqueue_notification_deliveries() AS count')).rows[0].count;
  const claimed = (await query('SELECT * FROM tanaghom.claim_notification_deliveries($1)', [limit])).rows;
  const results = [];
  for (const row of claimed) {
    let outcome;
    let target;
    try { target = decrypt(row); } catch { outcome = { sent: false, status: null, error: 'destination_decryption_failed', retryable: false }; }
    if (!outcome) {
      const transport = transports[row.channel];
      outcome = transport ? await transport(target, alertMessage(row))
        : { sent: false, status: null, error: 'channel_unsupported', retryable: false };
    }
    const state = (await query('SELECT tanaghom.complete_notification_delivery($1,$2,$3,$4,$5) AS state',
      [row.delivery_id, outcome.sent, outcome.status, outcome.error, outcome.retryable])).rows[0].state;
    results.push({ delivery_id: row.delivery_id, channel: row.channel, event_type: row.event_type, state, error: outcome.error });
  }
  return { enqueued, claimed: claimed.length, results };
}
