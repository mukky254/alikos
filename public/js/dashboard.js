// public/js/dashboard.js
renderNav('dashboard');
requireLogin();

const highlightId = new URLSearchParams(window.location.search).get('highlight');
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
let mine = [];
let brands = [];

async function load() {
  const body = document.getElementById('dashboardBody');
  try {
    const [bizRes, brandRes] = await Promise.all([api('/businesses/mine'), api('/businesses/brands/mine')]);
    mine = bizRes.businesses; brands = brandRes.brands;
    if (!mine.length) { body.innerHTML = `<div class="empty">No businesses yet. <a href="register.html" style="text-decoration:underline;">List one now</a>.</div>`; return; }
    body.innerHTML = `<select class="owner-select" id="ownerSelect">${mine.map((b) => `<option value="${b.id}" ${String(b.id) === highlightId ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select><div id="ownerStatsWrap"></div>`;
    document.getElementById('ownerSelect').addEventListener('change', paint);
    paint();
  } catch (e) { body.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}

function currentBiz() { const id = document.getElementById('ownerSelect').value; return mine.find((x) => String(x.id) === id); }
async function refreshCurrent() { const b = currentBiz(); const { business } = await api('/businesses/' + b.id); mine[mine.findIndex((x) => x.id === b.id)] = business; paint(); }

function paint() {
  const b = currentBiz();
  document.getElementById('ownerStatsWrap').innerHTML = `
    <div class="card">
      <h3>${escapeHtml(b.name)} ${b.verified ? '<span class="badge verified">VERIFIED</span>' : '<span class="badge pending">PENDING</span>'}</h3>
      <p class="muted" style="margin:4px 0 0;">${escapeHtml(b.building)} · Floor ${escapeHtml(b.floor || '—')} · Shop ${escapeHtml(b.shop || '—')}</p>
      <p style="margin:10px 0 0;display:flex;gap:16px;flex-wrap:wrap;"><a href="business.html?id=${b.id}" style="text-decoration:underline;">View profile →</a><button class="btn small ghost" id="exportCsvBtn">Download CSV</button><button class="btn small danger" id="deleteBizBtn" style="margin-left:auto;">🗑 Delete business</button></p>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${b.views}</div><div class="stat-label">Views</div></div>
      <div class="stat-card"><div class="stat-num">${b.navigations}</div><div class="stat-label">Navigations</div></div>
      <div class="stat-card"><div class="stat-num">${b.calls}</div><div class="stat-label">Calls</div></div>
      <div class="stat-card"><div class="stat-num">${b.whatsapp_clicks}</div><div class="stat-label">WhatsApp</div></div>
      <div class="stat-card"><div class="stat-num">${b.shares}</div><div class="stat-label">Shares</div></div>
      <div class="stat-card"><div class="stat-num">${b.reviews.length}${b.avgRating ? ' (' + b.avgRating + '★)' : ''}</div><div class="stat-label">Reviews</div></div>
      <div class="stat-card"><div class="stat-num">${b.confidence}%</div><div class="stat-label">Confidence</div></div>
    </div>
    <div class="card"><h3>Views — last 14 days</h3><div id="trendChart"><div class="loading">Loading…</div></div></div>
    <div class="card">
      <h3>Edit listing</h3>
      <form id="editForm">
        <div class="field-grid"><div class="field"><label>Name</label><input id="e-name" value="${escapeHtml(b.name)}"></div><div class="field"><label>Category</label><input id="e-category" value="${escapeHtml(b.category)}"></div></div>
        <div class="field-grid"><div class="field"><label>Phone</label><input id="e-phone" value="${escapeHtml(b.phone)}"></div><div class="field"><label>WhatsApp</label><input id="e-whatsapp" value="${escapeHtml(b.whatsapp)}"></div></div>
        <div class="field"><label>Description</label><textarea id="e-desc" rows="2">${escapeHtml(b.description)}</textarea></div>
        <div class="field"><label>Products / keywords</label><input id="e-tags" value="${escapeHtml((b.tags || []).join(', '))}"></div>
        <div class="field-grid"><div class="field"><label>Building</label><input id="e-building" value="${escapeHtml(b.building)}"></div><div class="field"><label>Floor</label><input id="e-floor" value="${escapeHtml(b.floor)}"></div><div class="field"><label>Shop</label><input id="e-shop" value="${escapeHtml(b.shop)}"></div></div>
        <div class="field-grid"><div class="field"><label>Entrance</label><input id="e-entrance" value="${escapeHtml(b.entrance)}"></div><div class="field"><label>Landmark</label><input id="e-landmark" value="${escapeHtml(b.landmark)}"></div></div>
        <button class="btn primary" type="submit">Save changes</button>
      </form>
    </div>
    <div class="card">
      <h3>Opening hours</h3>
      <form id="hoursForm">
        ${DAYS.map((d) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <label style="width:40px;font-weight:700;font-size:13px;">${DAY_LABELS[d]}</label>
          <input type="checkbox" class="day-open" data-day="${d}" ${b.hours && b.hours[d] ? 'checked' : ''}>
          <input type="time" class="day-start" data-day="${d}" value="${b.hours && b.hours[d] ? b.hours[d][0] : '09:00'}">
          <span>to</span>
          <input type="time" class="day-end" data-day="${d}" value="${b.hours && b.hours[d] ? b.hours[d][1] : '18:00'}">
        </div>`).join('')}
        <button class="btn" type="submit">Save hours</button>
      </form>
    </div>
    <div class="card">
      <h3>Brand / multi-location</h3>
      <div class="field-grid">
        <div class="field"><label>Assign to brand</label><select id="brandSelect"><option value="">No brand</option>${brands.map((br) => `<option value="${br.id}" ${b.brand && b.brand.id === br.id ? 'selected' : ''}>${escapeHtml(br.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Or create new</label><input id="newBrandName" placeholder="e.g. Al-Huda Group"></div>
      </div>
      <button class="btn small" id="saveBrandBtn">Save brand</button>
    </div>
    <div class="card">
      <h3>Deals &amp; offers</h3>
      <div id="offersList">${b.offers.length ? b.offers.map((o) => `<div class="admin-row"><div><strong>${escapeHtml(o.title)}</strong> ${o.discount ? '— ' + escapeHtml(o.discount) : ''}<div class="muted" style="font-size:12px;">Ends ${new Date(o.ends_at * 1000).toLocaleDateString()}</div></div><button class="btn small danger" data-offer-id="${o.id}">Remove</button></div>`).join('') : '<p class="muted" style="margin:0;">No active offers.</p>'}</div>
      <form id="offerForm" style="margin-top:14px;">
        <div class="field-grid"><div class="field"><label>Title</label><input id="o-title" required></div><div class="field"><label>Discount</label><input id="o-discount"></div></div>
        <div class="field-grid"><div class="field"><label>Description</label><input id="o-desc"></div><div class="field"><label>Ends on</label><input id="o-ends" type="date" required></div></div>
        <button class="btn" type="submit">Post offer</button>
      </form>
    </div>
    <div class="card">
      <h3>Photos</h3>
      <div class="photo-strip">${b.photos.length ? b.photos.map((p) => `<div class="photo-card"><img src="${p.filename}" alt="${escapeHtml(p.label)}"><span>${escapeHtml(p.label)}</span></div>`).join('') : '<div class="photo-card" style="display:flex;align-items:center;justify-content:center;color:var(--ink-faint);font-size:12px;">No photos</div>'}</div>
      <form id="photoForm" style="margin-top:14px;">
        <div class="field-grid"><div class="field"><label>Label</label><select id="photoLabel"><option>Street view</option><option>Building front</option><option>Entrance</option><option>Corridor</option><option>Shop front</option></select></div><div class="field"><label>Photo file</label><input type="file" id="photoFile" accept="image/*" required></div></div>
        <button class="btn" type="submit">Upload photo</button>
      </form>
    </div>
    <div class="card">
      <h3>Verification documents</h3>
      <p class="page-sub" style="margin:0 0 12px;">Only admins can view these.</p>
      <form id="docForm">
        <div class="field-grid"><div class="field"><label>Type</label><select id="docType"><option value="business_license">Business license</option><option value="national_id">National ID</option><option value="other">Other</option></select></div><div class="field"><label>File</label><input type="file" id="docFile" required></div></div>
        <button class="btn" type="submit">Upload document</button>
      </form>
    </div>
  `;
  wireForms(b);
  loadTrend(b.id);
}

function wireForms(b) {
  document.getElementById('exportCsvBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/businesses/' + b.id + '/export.csv', { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = b.name.replace(/[^a-z0-9]/gi, '_') + '.csv';
      a.click();
    } catch (e) { toast(e.message); }
  });

  // Feature: delete business. Requires typing the exact business name to
  // confirm — same pattern GitHub/Vercel use for destructive actions — so
  // this can never fire from a stray tap. The backend endpoint cascades
  // the delete across photos/reviews/offers/etc. automatically.
  document.getElementById('deleteBizBtn').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'arrival-overlay';
    overlay.innerHTML = `
      <div class="arrival-card" style="text-align:left;">
        <div class="arrival-title" style="color:var(--signal-red);">Delete "${escapeHtml(b.name)}"?</div>
        <p class="muted" style="margin:10px 0;">This permanently deletes the listing, its photos, reviews, offers, and analytics. This can't be undone.</p>
        <p style="font-size:12.5px;color:var(--ink-dim);margin-bottom:6px;">Type the business name to confirm:</p>
        <div class="field" style="margin-bottom:14px;"><input type="text" id="deleteConfirmInput" placeholder="${escapeHtml(b.name)}"></div>
        <div style="display:flex;gap:10px;">
          <button class="btn ghost block" id="deleteCancelBtn">Cancel</button>
          <button class="btn danger block" id="deleteConfirmBtn">Delete permanently</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#deleteCancelBtn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#deleteConfirmBtn').addEventListener('click', async () => {
      const typed = overlay.querySelector('#deleteConfirmInput').value;
      try {
        await api('/businesses/' + b.id, { method: 'DELETE', body: { confirmName: typed } });
        toast('Business deleted.');
        overlay.remove();
        window.location.reload();
      } catch (e) { toast(e.message); }
    });
  });

  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/businesses/' + b.id, { method: 'PUT', body: {
        name: document.getElementById('e-name').value.trim(), category: document.getElementById('e-category').value.trim(),
        phone: document.getElementById('e-phone').value.trim(), whatsapp: document.getElementById('e-whatsapp').value.trim(),
        description: document.getElementById('e-desc').value.trim(), tags: document.getElementById('e-tags').value.trim(),
        building: document.getElementById('e-building').value.trim(), floor: document.getElementById('e-floor').value.trim(),
        shop: document.getElementById('e-shop').value.trim(), entrance: document.getElementById('e-entrance').value.trim(),
        landmark: document.getElementById('e-landmark').value.trim(),
      }});
      toast('Listing updated.'); refreshCurrent();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('hoursForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const hours = {};
    DAYS.forEach((d) => {
      const isOpen = document.querySelector(`.day-open[data-day="${d}"]`).checked;
      hours[d] = isOpen ? [document.querySelector(`.day-start[data-day="${d}"]`).value, document.querySelector(`.day-end[data-day="${d}"]`).value] : null;
    });
    try { await api('/businesses/' + b.id, { method: 'PUT', body: { hours } }); toast('Hours saved.'); refreshCurrent(); }
    catch (err) { toast(err.message); }
  });

  document.getElementById('saveBrandBtn').addEventListener('click', async () => {
    try {
      let brandId = document.getElementById('brandSelect').value || null;
      const newName = document.getElementById('newBrandName').value.trim();
      if (newName) { const { brand } = await api('/businesses/brands', { method: 'POST', body: { name: newName } }); brandId = brand.id; }
      await api('/businesses/' + b.id + '/brand', { method: 'PUT', body: { brandId } });
      toast('Brand saved.'); load();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('offerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/offers/business/' + b.id, { method: 'POST', body: { title: document.getElementById('o-title').value.trim(), discount: document.getElementById('o-discount').value.trim(), description: document.getElementById('o-desc').value.trim(), endsAt: document.getElementById('o-ends').value } });
      toast('Offer posted.'); refreshCurrent();
    } catch (err) { toast(err.message); }
  });
  document.querySelectorAll('[data-offer-id]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await api('/offers/' + btn.dataset.offerId, { method: 'DELETE' }); toast('Removed.'); refreshCurrent(); }
    catch (err) { toast(err.message); }
  }));

  document.getElementById('photoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('photoFile').files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('photo', file); fd.append('label', document.getElementById('photoLabel').value);
    try { await api('/businesses/' + b.id + '/photos', { method: 'POST', body: fd }); toast('Uploaded.'); refreshCurrent(); }
    catch (err) { toast(err.message); }
  });

  document.getElementById('docForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('docFile').files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('document', file); fd.append('docType', document.getElementById('docType').value);
    try { await api('/businesses/' + b.id + '/documents', { method: 'POST', body: fd }); toast('Submitted for review.'); e.target.reset(); }
    catch (err) { toast(err.message); }
  });
}

async function loadTrend(businessId) {
  const el = document.getElementById('trendChart');
  try {
    const { days } = await api('/businesses/' + businessId + '/stats-daily');
    // Fix: days with zero activity simply have no row in stats_daily, so
    // the raw array silently skips them — a business with views on only
    // 4 of the last 14 days would render 4 bars, not 14, which visually
    // compresses the timeline and misrepresents which days are adjacent.
    // Fill every calendar day in the window explicitly, zero-filled.
    const byDay = {};
    days.forEach((d) => { byDay[d.day] = d; });
    const filled = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      filled.push(byDay[key] || { day: key, views: 0, navigations: 0, calls: 0, whatsapp_clicks: 0 });
    }
    if (!days.length) { el.innerHTML = '<p class="muted" style="margin:0;">No traffic data yet.</p>'; return; }
    const max = Math.max(...filled.map((d) => d.views), 1);
    el.innerHTML = `<div class="trend-bars">${filled.map((d) => `<div title="${d.day}: ${d.views} views" style="height:${Math.max(4, (d.views / max) * 100)}%;"></div>`).join('')}</div>`;
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}

load();
