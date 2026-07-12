/**
 * Human Approval Dashboard — the single human checkpoint.
 * Lists content_items WHERE status = pending_approval.
 * Approve → DB status=approved + webhook Agent 3
 * Reject  → DB status=rejected + webhook Agent 2 (regeneration)
 *
 * Hard rule: Agent 3 still re-checks DB status before posting.
 */

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3080);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const AUTH_USER = process.env.DASHBOARD_AUTH_USER || 'reviewer';
const AUTH_PASSWORD = process.env.DASHBOARD_AUTH_PASSWORD || 'change_me_dashboard';
const PUBLIC_WEBHOOK_BASE = (process.env.PUBLIC_WEBHOOK_BASE || 'http://localhost:5678').replace(/\/$/, '');
const WEBHOOK_AGENT2_PATH = process.env.WEBHOOK_AGENT2_PATH || 'agent-2-content-producer';
const WEBHOOK_AGENT3_PATH = process.env.WEBHOOK_AGENT3_PATH || 'agent-3-publisher';
const INTERNAL_WEBHOOK_SECRET = process.env.INTERNAL_WEBHOOK_SECRET || '';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Content Approval"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  if (user !== AUTH_USER || pass !== AUTH_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Content Approval"');
    return res.status(401).send('Invalid credentials');
  }
  req.reviewer = user;
  return next();
}

app.use(basicAuth);

async function logAction({ agentName, actionType, entityType, entityId, payload, result, errorMessage }) {
  await pool.query(
    `INSERT INTO agent_actions_log
      (agent_name, action_type, entity_type, entity_id, payload, result, error_message)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      agentName,
      actionType,
      entityType,
      entityId,
      JSON.stringify(payload || {}),
      result,
      errorMessage || null,
    ]
  );
}

async function fireWebhook(pathSegment, body) {
  const url = `${PUBLIC_WEBHOOK_BASE}/webhook/${pathSegment}`;
  const headers = { 'Content-Type': 'application/json' };
  if (INTERNAL_WEBHOOK_SECRET) {
    headers['X-Internal-Secret'] = INTERNAL_WEBHOOK_SECRET;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Webhook ${url} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return text;
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/pipeline', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM v_campaign_pipeline LIMIT 50');
    res.json({ campaigns: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pending', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM v_pending_approvals');
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/content/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ci.*, c.name AS campaign_name, c.product_type, c.brief
       FROM content_items ci
       JOIN campaigns c ON c.id = ci.campaign_id
       WHERE ci.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Approve: only human path to status=approved
 */
app.post('/api/content/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE content_items
       SET status = 'approved',
           approved_by = $2,
           approved_at = now(),
           rejection_reason = NULL
       WHERE id = $1 AND status = 'pending_approval'
       RETURNING *`,
      [req.params.id, req.reviewer]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Item is not pending_approval (or missing). Source of truth is DB status.',
      });
    }
    const item = rows[0];
    await client.query(
      `INSERT INTO agent_actions_log
        (agent_name, action_type, entity_type, entity_id, payload, result)
       VALUES ('human_approval', 'approve_content', 'content_item', $1, $2::jsonb, 'success')`,
      [item.id, JSON.stringify({ approved_by: req.reviewer, campaign_id: item.campaign_id })]
    );
    await client.query('COMMIT');

    let webhookError = null;
    try {
      await fireWebhook(WEBHOOK_AGENT3_PATH, {
        event: 'content_approved',
        content_item_id: item.id,
        campaign_id: item.campaign_id,
      });
    } catch (err) {
      webhookError = err.message;
      await logAction({
        agentName: 'human_approval',
        actionType: 'fire_agent3_webhook',
        entityType: 'content_item',
        entityId: item.id,
        payload: { path: WEBHOOK_AGENT3_PATH },
        result: 'failed',
        errorMessage: err.message,
      });
    }

    res.json({
      ok: true,
      item,
      agent3_webhook: webhookError ? { ok: false, error: webhookError } : { ok: true },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * Reject: requires rejection_reason; re-triggers Agent 2 for regeneration
 */
app.post('/api/content/:id/reject', async (req, res) => {
  const reason = (req.body && req.body.rejection_reason || '').trim();
  if (!reason) {
    return res.status(400).json({ error: 'rejection_reason is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE content_items
       SET status = 'rejected',
           rejection_reason = $2,
           approved_by = NULL,
           approved_at = NULL
       WHERE id = $1 AND status = 'pending_approval'
       RETURNING *`,
      [req.params.id, reason]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Item is not pending_approval (or missing).' });
    }
    const item = rows[0];
    await client.query(
      `INSERT INTO agent_actions_log
        (agent_name, action_type, entity_type, entity_id, payload, result)
       VALUES ('human_approval', 'reject_content', 'content_item', $1, $2::jsonb, 'success')`,
      [
        item.id,
        JSON.stringify({
          rejected_by: req.reviewer,
          rejection_reason: reason,
          campaign_id: item.campaign_id,
        }),
      ]
    );
    await client.query('COMMIT');

    let webhookError = null;
    try {
      await fireWebhook(WEBHOOK_AGENT2_PATH, {
        event: 'content_rejected',
        content_item_id: item.id,
        campaign_id: item.campaign_id,
        rejection_reason: reason,
        mode: 'regenerate',
      });
    } catch (err) {
      webhookError = err.message;
      await logAction({
        agentName: 'human_approval',
        actionType: 'fire_agent2_webhook',
        entityType: 'content_item',
        entityId: item.id,
        payload: { path: WEBHOOK_AGENT2_PATH },
        result: 'failed',
        errorMessage: err.message,
      });
    }

    res.json({
      ok: true,
      item,
      agent2_webhook: webhookError ? { ok: false, error: webhookError } : { ok: true },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/audit', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      `SELECT * FROM agent_actions_log ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ actions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Weekly / latest sales report (Agent 4) */
app.get('/api/sales-report', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sales_reports ORDER BY created_at DESC LIMIT 10`
    );
    res.json({ reports: rows });
  } catch (err) {
    // Table may not exist until migration 003
    res.status(500).json({ error: err.message, reports: [] });
  }
});

/** Warm non-buyers available for future campaigns */
app.get('/api/requeue-leads', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM v_leads_available_for_requeue LIMIT 100`
    );
    res.json({ leads: rows });
  } catch (err) {
    res.status(500).json({ error: err.message, leads: [] });
  }
});

/** Sales message templates — second human gate (same governance as content) */
app.get('/api/templates', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, template_key, name, channel, subject, body, sequence_key,
              sequence_order, status, approved_by, approved_at, version
       FROM message_templates
       ORDER BY sequence_key, sequence_order, version DESC`
    );
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: err.message, templates: [] });
  }
});

app.post('/api/templates/:id/approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE message_templates
       SET status = 'approved', approved_by = $2, approved_at = now()
       WHERE id = $1 AND status IN ('draft', 'pending_approval')
       RETURNING *`,
      [req.params.id, req.reviewer]
    );
    if (!rows.length) {
      return res.status(409).json({ error: 'Template not pending approval' });
    }
    await logAction({
      agentName: 'human_approval',
      actionType: 'approve_message_template',
      entityType: 'message_template',
      entityId: rows[0].id,
      payload: { template_key: rows[0].template_key, approved_by: req.reviewer },
      result: 'success',
    });
    res.json({ ok: true, template: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Mark a lead as won (manual close) — logs purchase activity
 */
app.post('/api/leads/:id/won', async (req, res) => {
  const amount = req.body?.revenue_amount != null ? Number(req.body.revenue_amount) : null;
  try {
    const { rows } = await pool.query(
      `UPDATE leads SET
         status = 'won',
         available_for_requeue = false,
         closed_at = now(),
         revenue_amount = COALESCE($2, revenue_amount),
         last_touch_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [req.params.id, amount]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    await pool.query(
      `INSERT INTO sales_activities (lead_id, activity_type, channel, notes, outcome, payload)
       VALUES ($1::uuid, 'purchase', 'system', $2, 'won', $3::jsonb)`,
      [
        req.params.id,
        `Closed won by ${req.reviewer}`,
        JSON.stringify({ revenue_amount: amount, closed_by: req.reviewer }),
      ]
    );
    await logAction({
      agentName: 'human_approval',
      actionType: 'lead_won',
      entityType: 'lead',
      entityId: rows[0].id,
      payload: { revenue_amount: amount },
      result: 'success',
    });
    res.json({ ok: true, lead: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Approval dashboard listening on :${port}`);
});
