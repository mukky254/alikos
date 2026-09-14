// public/js/admin.js
const gateUser = requireAdminUI();
if (gateUser) {
  renderNav('admin');
  wireTabs();
  loadStats();
  loadPending();
}

function wireTabs() {
  const tabs = ['pending', 'all', 'reports', 'claims', 'documents', 'analytics', 'audit', 'import', 'users'];
  document.querySelectorAll('#adminTabs .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#adminTabs .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      tabs.forEach((t) => document.getElementById('tab-' + t).classList.toggle('hidden', t !== chip.dataset.tab));
      const loaders = { pending: loadPending, all: loadAll, reports: loadReports, claims: loadClaims, documents: loadDocuments, analytics: loadAnalytics, audit: loadAudit, users: loadUsers };
      if (loaders[chip.dataset.tab]) loaders[chip.dataset.tab]();
    });
  });
  document.getElementById('importForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('importFile').files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await api('/admin/businesses/bulk-import', { method: 'POST', body: fd });
      document.getElementById('importResult').innerHTML = `<div class="note" style="margin-top:12px;">Imported ${res.created} business(es).${res.errors.length ? '<br>' + res.errors.map(escapeHtml).join('; ') : ''}</div>`;
      toast(`Imported ${res.created} businesses.`); loadStats();
    } catch (err) { document.getElementById('importResult').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`; }
  });
}

async function loadStats() {
  try {
    const s = await api('/admin/stats');
    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card"><div class="stat-num">${s.total}</div><div class="stat-label">Businesses</div></div>
      <div class="stat-card"><div class="stat-num">${s.verified}</div><div class="stat-label">Verified</div></div>
      <div class="stat-card"><div class="stat-num">${s.pending}</div><div class="stat-label">Pending</div></div>
      <div class="stat-card"><div class="stat-num">${s.openReports}</div><div class="stat-label">Open reports</div></div>
      <div class="stat-card"><div class="stat-num">${s.pendingClaims}</div><div class="stat-label">Claims</div></div>
      <div class="stat-card"><div class="stat-num">${s.pendingDocs}</div><div class="stat-label">Documents</div></div>
      <div class="stat-card"><div class="stat-num">${s.totalUsers}</div><div class="stat-label">Users</div></div>
      <div class="stat-card"><div class="stat-num">${s.totalReviews}</div><div class="stat-label">Reviews</div></div>
      <div class="stat-card"><div class="stat-num">${s.totalViews}</div><div class="stat-label">Total views</div></div>`;
  } catch (e) { document.getElementById('adminStats').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}

function bizRow(b) {
  return `<div class="admin-row" data-id="${b.id}">
    <div><strong>${escapeHtml(b.name)}</strong> — ${escapeHtml(b.category)}<br><span class="muted" style="font-size:12px;">${escapeHtml(b.building)} · Floor ${escapeHtml(b.floor || '—')} · Shop ${escapeHtml(b.shop || '—')}</span></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      ${b.verified ? '<span class="badge verified">VERIFIED</span>' : '<span class="badge pending">PENDING</span>'}
      <select class="tier-select" data-id="${b.id}"><option value="none" ${b.verification_tier === 'none' ? 'selected' : ''}>Tier: none</option><option value="basic" ${b.verification_tier === 'basic' ? 'selected' : ''}>Tier: basic</option><option value="premium" ${b.verification_tier === 'premium' ? 'selected' : ''}>Tier: premium</option></select>
      ${b.verified ? `<button class="btn small ghost" data-action="unverify">Revoke</button>` : `<button class="btn small" data-action="verify">Verify</button>`}
      <button class="btn small danger" data-action="reject">Remove</button>
    </div>
  </div>`;
}
function wireBizActions(container) {
  container.querySelectorAll('.admin-row').forEach((row) => {
    row.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', async () => {
      const id = row.dataset.id, action = btn.dataset.action;
      try {
        if (action === 'verify') await api(`/admin/businesses/${id}/verify`, { method: 'POST' });
        if (action === 'unverify') await api(`/admin/businesses/${id}/unverify`, { method: 'POST' });
        if (action === 'reject') { if (!confirm('Remove permanently?')) return; await api(`/admin/businesses/${id}`, { method: 'DELETE' }); }
        toast('Updated.'); loadStats(); loadPending(); loadAll();
      } catch (e) { toast(e.message); }
    }));
    row.querySelector('.tier-select').addEventListener('change', async (e) => {
      try { await api(`/admin/businesses/${row.dataset.id}/tier`, { method: 'PUT', body: { tier: e.target.value } }); toast('Tier updated.'); }
      catch (err) { toast(err.message); }
    });
  });
}

async function loadPending() {
  const el = document.getElementById('adminPending');
  try { const { businesses } = await api('/admin/businesses?status=pending'); el.innerHTML = businesses.length ? businesses.map(bizRow).join('') : '<p class="muted" style="margin:0;">All caught up.</p>'; wireBizActions(el); }
  catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadAll() {
  const el = document.getElementById('adminAll');
  try { const { businesses } = await api('/admin/businesses'); el.innerHTML = businesses.map(bizRow).join(''); wireBizActions(el); }
  catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadReports() {
  const el = document.getElementById('adminReports');
  try {
    const { reports } = await api('/admin/reports');
    el.innerHTML = reports.length ? reports.map((r) => `<div class="admin-row" data-id="${r.id}"><div><strong><a href="business.html?id=${r.business_id}">${escapeHtml(r.business_name)}</a></strong><br><span class="muted" style="font-size:12px;">${escapeHtml(r.reason)}</span></div><div style="display:flex;gap:8px;"><button class="btn small" data-action="resolve">Resolve</button><button class="btn small ghost" data-action="dismiss">Dismiss</button></div></div>`).join('') : '<p class="muted" style="margin:0;">No open reports.</p>';
    el.querySelectorAll('.admin-row').forEach((row) => row.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/admin/reports/${row.dataset.id}/${btn.dataset.action}`, { method: 'POST' }); toast('Updated.'); loadReports(); loadStats(); } catch (e) { toast(e.message); }
    })));
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadClaims() {
  const el = document.getElementById('adminClaims');
  try {
    const { claims } = await api('/admin/claims');
    el.innerHTML = claims.length ? claims.map((c) => `<div class="admin-row" data-id="${c.id}"><div><strong><a href="business.html?id=${c.business_id}">${escapeHtml(c.business_name)}</a></strong> claimed by ${escapeHtml(c.claimant_name)}<br><span class="muted" style="font-size:12px;">${escapeHtml(c.message || 'No message.')}</span></div><div style="display:flex;gap:8px;"><button class="btn small" data-action="approve">Approve</button><button class="btn small ghost" data-action="reject">Reject</button></div></div>`).join('') : '<p class="muted" style="margin:0;">No pending claims.</p>';
    el.querySelectorAll('.admin-row').forEach((row) => row.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/admin/claims/${row.dataset.id}/${btn.dataset.action}`, { method: 'POST' }); toast('Updated.'); loadClaims(); loadStats(); } catch (e) { toast(e.message); }
    })));
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadDocuments() {
  const el = document.getElementById('adminDocuments');
  try {
    const { documents } = await api('/admin/documents');
    el.innerHTML = documents.length ? documents.map((d) => `<div class="admin-row" data-id="${d.id}"><div><strong>${escapeHtml(d.business_name)}</strong> — ${escapeHtml(d.doc_type)}<br><button class="btn small ghost view-doc-btn" data-filename="${escapeHtml(d.filename)}" style="margin-top:4px;padding:2px 8px;">View file</button></div><div style="display:flex;gap:8px;"><button class="btn small" data-action="approve">Approve</button><button class="btn small ghost" data-action="reject">Reject</button></div></div>`).join('') : '<p class="muted" style="margin:0;">No pending documents.</p>';
    el.querySelectorAll('.view-doc-btn').forEach((btn) => btn.addEventListener('click', async () => {
      try { const res = await fetch('/api/admin/documents/' + encodeURIComponent(btn.dataset.filename), { headers: { Authorization: 'Bearer ' + getToken() } }); if (!res.ok) throw new Error('Could not load file.'); const blob = await res.blob(); window.open(URL.createObjectURL(blob), '_blank'); } catch (e) { toast(e.message); }
    }));
    el.querySelectorAll('.admin-row').forEach((row) => row.querySelectorAll('button:not(.view-doc-btn)').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/admin/documents/${row.dataset.id}/${btn.dataset.action}`, { method: 'POST' }); toast('Updated.'); loadDocuments(); loadStats(); } catch (e) { toast(e.message); }
    })));
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadAnalytics() {
  try {
    const { byCategory, growth } = await api('/admin/analytics');
    const catMax = Math.max(...byCategory.map((c) => c.count), 1);
    document.getElementById('chartCategory').innerHTML = byCategory.map((c) => `<div class="bar-row"><div class="label">${escapeHtml(c.category)}</div><div class="track"><div class="fill" style="width:${(c.count / catMax) * 100}%;"></div></div><div class="val">${c.count}</div></div>`).join('');
    const growthMax = Math.max(...growth.map((g) => g.count), 1);
    document.getElementById('chartGrowth').innerHTML = growth.length ? `<div class="trend-bars">${growth.map((g) => `<div title="${g.day}: ${g.count}" style="height:${Math.max(4, (g.count / growthMax) * 100)}%;"></div>`).join('')}</div>` : '<p class="muted" style="margin:0;">No new listings recently.</p>';
  } catch (e) { document.getElementById('chartCategory').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadAudit() {
  const el = document.getElementById('adminAudit');
  try {
    const { log } = await api('/admin/audit-log');
    el.innerHTML = log.length ? log.map((l) => `<div class="admin-row"><div><strong>${escapeHtml(l.admin_name)}</strong> ${escapeHtml(l.action)} ${escapeHtml(l.target_type)}${l.target_id ? ' #' + l.target_id : ''}${l.details ? ' — ' + escapeHtml(l.details) : ''}</div><div class="muted" style="font-size:11px;">${new Date(l.created_at * 1000).toLocaleString()}</div></div>`).join('') : '<p class="muted" style="margin:0;">No admin actions logged yet.</p>';
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
async function loadUsers() {
  const el = document.getElementById('adminUsers');
  try {
    const { users } = await api('/admin/users');
    el.innerHTML = users.map((u) => `<div class="admin-row"><div><strong>${escapeHtml(u.name)}</strong> — ${escapeHtml(u.email)}</div><div>${u.role === 'admin' ? '<span class="badge premium">ADMIN</span>' : '<span class="badge pending">USER</span>'}</div></div>`).join('');
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}
