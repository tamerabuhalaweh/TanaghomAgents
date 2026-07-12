const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let rejectTargetId = null;

function toast(message, type = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden', 'ok', 'err');
  el.classList.add(type === 'err' ? 'err' : 'ok');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 4200);
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderQueue(items) {
  const list = $('#queueList');
  const empty = $('#queueEmpty');
  $('#pendingCount').textContent = String(items.length);

  if (!items.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = items.map((item) => `
    <article class="card" data-id="${item.id}">
      <div class="card-top">
        <div>
          <h3 class="title">${escapeHtml(item.campaign_name || 'Campaign')}</h3>
          <div class="meta" style="margin-top:0.45rem">
            <span class="chip channel">${escapeHtml(item.channel)}</span>
            <span class="chip type">${escapeHtml(item.content_type)}</span>
            ${item.content_pillar ? `<span class="chip">${escapeHtml(item.content_pillar)}</span>` : ''}
            ${item.product_type ? `<span class="chip">${escapeHtml(item.product_type)}</span>` : ''}
          </div>
        </div>
        <div class="time">
          <div>Created ${fmtTime(item.created_at)}</div>
          <div>Schedule ${fmtTime(item.scheduled_time)}</div>
        </div>
      </div>
      <div class="copy-block">
        <p class="label">Draft copy</p>
        <pre>${escapeHtml(item.draft_copy || '')}</pre>
      </div>
      <div class="brief-block">
        <p class="label">Media brief</p>
        <p>${escapeHtml(item.media_brief || '—')}</p>
      </div>
      <div class="actions">
        <button class="btn primary" data-action="approve" data-id="${item.id}">Approve</button>
        <button class="btn danger" data-action="reject" data-id="${item.id}">Reject</button>
      </div>
    </article>
  `).join('');
}

function renderPipeline(campaigns) {
  const body = $('#pipelineBody');
  if (!campaigns.length) {
    body.innerHTML = `<tr><td colspan="8" style="color:var(--muted)">No campaigns yet.</td></tr>`;
    return;
  }
  body.innerHTML = campaigns.map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td><span class="status-pill">${escapeHtml(c.status)}</span></td>
      <td>${escapeHtml(c.product_type || '—')}</td>
      <td>${c.content_total ?? 0}</td>
      <td>${c.content_pending ?? 0}</td>
      <td>${c.content_posted ?? 0}</td>
      <td>${c.leads_total ?? 0}</td>
      <td>${c.leads_won ?? 0}</td>
    </tr>
  `).join('');
}

function renderAudit(actions) {
  const body = $('#auditBody');
  if (!actions.length) {
    body.innerHTML = `<tr><td colspan="5" style="color:var(--muted)">No agent actions logged yet.</td></tr>`;
    return;
  }
  body.innerHTML = actions.map((a) => `
    <tr>
      <td>${fmtTime(a.created_at)}</td>
      <td>${escapeHtml(a.agent_name)}</td>
      <td>${escapeHtml(a.action_type)}</td>
      <td>${escapeHtml([a.entity_type, a.entity_id].filter(Boolean).join(' · ') || '—')}</td>
      <td><span class="status-pill">${escapeHtml(a.result)}</span></td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTemplates(templates) {
  const el = $('#templatesList');
  if (!templates.length) {
    el.innerHTML = `<div class="empty">No templates. Run migration 004 seed, then approve them here.</div>`;
    return;
  }
  el.innerHTML = templates.map((t) => `
    <article class="card">
      <div class="card-top">
        <div>
          <h3 class="title">${escapeHtml(t.name || t.template_key)}</h3>
          <div class="meta" style="margin-top:0.45rem">
            <span class="chip">${escapeHtml(t.template_key)}</span>
            <span class="chip channel">${escapeHtml(t.channel)}</span>
            <span class="chip type">${escapeHtml(t.status)}</span>
            <span class="chip">seq ${escapeHtml(String(t.sequence_order))}</span>
          </div>
        </div>
        <div class="time">v${escapeHtml(String(t.version || 1))}</div>
      </div>
      ${t.subject ? `<div class="brief-block"><p class="label">Subject</p><p>${escapeHtml(t.subject)}</p></div>` : ''}
      <div class="copy-block">
        <p class="label">Body</p>
        <pre>${escapeHtml(t.body || '')}</pre>
      </div>
      <div class="actions">
        ${t.status === 'approved'
          ? `<span class="chip type">approved${t.approved_by ? ' by ' + escapeHtml(t.approved_by) : ''}</span>`
          : `<button class="btn primary" data-action="approve-tpl" data-id="${t.id}">Approve template</button>`}
      </div>
    </article>
  `).join('');
}

function renderSales(reports, requeue) {
  const cards = $('#salesReportCards');
  if (!reports.length) {
    cards.innerHTML = `<div class="empty">No sales reports yet. Agent 4 weekly job writes them here.</div>`;
  } else {
    cards.innerHTML = reports.map((r) => `
      <article class="card">
        <div class="card-top">
          <h3 class="title">Report ${fmtTime(r.period_start)} → ${fmtTime(r.period_end)}</h3>
          <div class="time">${fmtTime(r.created_at)}</div>
        </div>
        <div class="meta">
          <span class="chip type">won ${r.won_count}</span>
          <span class="chip">lost ${r.lost_count}</span>
          <span class="chip">nurture ${r.nurture_count}</span>
          <span class="chip channel">in progress ${r.in_progress}</span>
          <span class="chip">revenue ${r.revenue_won ?? 0} / ${r.revenue_target ?? '—'}</span>
        </div>
      </article>
    `).join('');
  }

  const body = $('#requeueBody');
  if (!requeue.length) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--muted)">No leads flagged available_for_requeue.</td></tr>`;
    return;
  }
  body.innerHTML = requeue.map((l) => `
    <tr>
      <td>${escapeHtml(l.name || '—')}</td>
      <td>${escapeHtml(l.source_campaign_name || '—')}</td>
      <td>${escapeHtml(l.temperature || '—')}</td>
      <td><span class="status-pill">${escapeHtml(l.status)}</span></td>
      <td>${escapeHtml(l.contact_email || '—')}</td>
      <td>${fmtTime(l.last_touch_at)}</td>
    </tr>
  `).join('');
}

async function loadAll() {
  const [pending, pipeline, audit, sales, requeue, templates] = await Promise.all([
    api('/api/pending'),
    api('/api/pipeline'),
    api('/api/audit?limit=80'),
    api('/api/sales-report').catch(() => ({ reports: [] })),
    api('/api/requeue-leads').catch(() => ({ leads: [] })),
    api('/api/templates').catch(() => ({ templates: [] })),
  ]);
  renderQueue(pending.items || []);
  renderPipeline(pipeline.campaigns || []);
  renderAudit(audit.actions || []);
  renderSales(sales.reports || [], requeue.leads || []);
  renderTemplates(templates.templates || []);
}

async function approve(id, btn) {
  btn.disabled = true;
  try {
    const result = await api(`/api/content/${id}/approve`, { method: 'POST', body: '{}' });
    const wh = result.agent3_webhook?.ok ? 'Agent 3 notified.' : `Approved in DB; webhook warning: ${result.agent3_webhook?.error || 'unknown'}`;
    toast(`Approved. ${wh}`);
    await loadAll();
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
  }
}

function openReject(id) {
  rejectTargetId = id;
  $('#rejectReason').value = '';
  $('#rejectDialog').showModal();
}

async function submitReject(e) {
  e.preventDefault();
  const reason = $('#rejectReason').value.trim();
  if (!reason || !rejectTargetId) return;
  try {
    const result = await api(`/api/content/${rejectTargetId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejection_reason: reason }),
    });
    const wh = result.agent2_webhook?.ok ? 'Agent 2 regenerating.' : `Rejected in DB; webhook warning: ${result.agent2_webhook?.error || 'unknown'}`;
    toast(`Rejected. ${wh}`);
    $('#rejectDialog').close();
    rejectTargetId = null;
    await loadAll();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// Tabs
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#panel-${tab.dataset.tab}`).classList.add('active');
  });
});

$('#queueList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'approve') approve(id, btn);
  if (btn.dataset.action === 'reject') openReject(id);
});

$('#templatesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="approve-tpl"]');
  if (!btn) return;
  btn.disabled = true;
  try {
    await api(`/api/templates/${btn.dataset.id}/approve`, { method: 'POST', body: '{}' });
    toast('Template approved — Agent 4 may use it.');
    await loadAll();
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
  }
});

$('#rejectForm').addEventListener('submit', submitReject);
$('#rejectCancel').addEventListener('click', () => {
  $('#rejectDialog').close();
  rejectTargetId = null;
});
$('#refreshBtn').addEventListener('click', () => {
  loadAll().then(() => toast('Refreshed')).catch((err) => toast(err.message, 'err'));
});

loadAll().catch((err) => toast(err.message, 'err'));
setInterval(() => {
  loadAll().catch(() => {});
}, 30000);
