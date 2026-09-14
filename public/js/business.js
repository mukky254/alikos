// public/js/business.js
renderNav('home');

const params = new URLSearchParams(window.location.search);
const bizId = params.get('id');

let saved = false;
let profileMap = null;
let currentBusiness_forNav = null;

const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/* ============================= LOAD ============================= */

async function load() {
  if (!bizId) { document.getElementById('profileMain').innerHTML = '<div class="empty">No business selected.</div>'; return; }
  try {
    const { business } = await api('/businesses/' + bizId);
    currentBusiness_forNav = business;
    await api('/businesses/' + bizId + '/track', { method: 'POST', body: { type: 'view' } }).catch(() => {});
    rememberRecentlyViewed(business);
    if (getUser()) {
      try { const { businesses } = await api('/saved'); saved = businesses.some((b) => b.id == bizId); } catch (e) {}
    }
    render(business);
    initProfileMap(business);
    loadQA(business.id);
    if (window.checkResumableNav) checkResumableNav(business);
  } catch (e) {
    document.getElementById('profileMain').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

function rememberRecentlyViewed(b) {
  try {
    let list = JSON.parse(localStorage.getItem('aliko_recent') || '[]');
    list = list.filter((x) => x.id !== b.id);
    list.unshift({ id: b.id, name: b.name, category: b.category, building: b.building });
    localStorage.setItem('aliko_recent', JSON.stringify(list.slice(0, 10)));
  } catch (e) {}
}

function tierBadge(b) {
  if (!b.verified) return '<span class="badge pending">PENDING VERIFICATION</span>';
  if (b.verification_tier === 'premium') return '<span class="badge premium">PREMIUM VERIFIED</span>';
  return '<span class="badge verified">VERIFIED</span>';
}

function hoursTable(hours) {
  if (!hours) return '<p class="muted" style="margin:0;">Hours not provided yet.</p>';
  return Object.keys(DAY_LABELS).map((d) => `<div class="hours-row"><span class="muted">${DAY_LABELS[d]}</span><span>${hours[d] ? escapeHtml(hours[d][0]) + ' – ' + escapeHtml(hours[d][1]) : 'Closed'}</span></div>`).join('');
}

/* ============================= RENDER ============================= */

function render(b) {
  const waNum = (b.whatsapp || '').replace(/[^0-9]/g, '');
  const user = getUser();
  const isOwner = user && user.id === b.owner_id;

  document.getElementById('profileMain').innerHTML = `
    <button class="back-link" onclick="window.location.href='index.html'">← Back to Discover</button>

    <div class="profile-top">
      <div>
        <h1 class="profile-name">${escapeHtml(b.name)} ${tierBadge(b)} ${b.openNow === true ? '<span class="badge open">OPEN NOW</span>' : b.openNow === false ? '<span class="badge closed">CLOSED</span>' : ''}</h1>
        <div class="profile-meta">${escapeHtml(b.category)} ${b.avgRating ? `· <span class="stars">${'★'.repeat(Math.round(b.avgRating))}</span> ${b.avgRating} (${b.reviews.length})` : '· No reviews yet'}</div>
        ${b.tags && b.tags.length ? `<div class="chip-row" style="margin:10px 0 0;">${b.tags.map((t) => `<span class="chip tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="icon-btn" id="saveBtn" title="Save">${saved ? '★' : '☆'}</button>
        <button class="icon-btn" id="shareBtn" title="Share">🔗</button>
      </div>
    </div>

    <p class="profile-desc">${escapeHtml(b.description || 'No description provided yet.')}</p>

    ${b.offers && b.offers.length ? `<div class="card" style="border-color:var(--signal-amber);">
      <h3>🏷 Active deals</h3>
      ${b.offers.map((o) => `<div style="margin-bottom:10px;"><strong>${escapeHtml(o.title)}</strong> ${o.discount ? '— ' + escapeHtml(o.discount) : ''}<div class="muted" style="font-size:12.5px;">${escapeHtml(o.description || '')} Ends ${new Date(o.ends_at * 1000).toLocaleDateString()}</div></div>`).join('')}
    </div>` : ''}

    ${b.brand ? `<p class="note">Part of <strong>${escapeHtml(b.brand.name)}</strong>${b.otherLocations && b.otherLocations.length ? ' — also at: ' + b.otherLocations.map((l) => escapeHtml(l.name) + ' (' + escapeHtml(l.building) + ')').join(', ') : ''}</p>` : ''}

    <div class="action-row">
      <a class="btn" href="tel:${escapeHtml(b.phone || '')}">📞 Call</a>
      ${waNum ? `<a class="btn" href="https://wa.me/${waNum}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      <button class="btn ghost" id="reportBtn">🚩 Report</button>
      ${user && !isOwner ? `<button class="btn ghost" id="claimBtn">Claim this business</button>` : ''}
    </div>

    <div class="profile-grid">
      <div class="map-card">
        <div class="map-label"><span class="live-dot"></span> Live map</div>
        <div id="map"></div>
      </div>
      <div>
        <div class="address-plate" style="margin-bottom:14px;">
          <div><div class="addr-label">Building</div><div class="addr-val small">${escapeHtml(b.building || '—')}</div></div>
          <div><div class="addr-label">Floor</div><div class="addr-val">${escapeHtml(b.floor || '—')}</div></div>
          <div><div class="addr-label">Shop</div><div class="addr-val">${escapeHtml(b.shop || '—')}</div></div>
          <div><div class="addr-label">Entrance</div><div class="addr-val small">${escapeHtml(b.entrance || '—')}</div></div>
          <div style="grid-column:1/-1;"><div class="addr-label">Landmark</div><div class="addr-val small">${escapeHtml(b.landmark || '—')}</div></div>
        </div>
        <button class="btn primary block" id="navigateBtn">Start navigation →</button>
        <div class="gps-status" id="navPreStatus"></div>
      </div>
    </div>

    <div class="photo-strip">
      ${b.photos && b.photos.length
        ? b.photos.map((p) => `<div class="photo-card"><img src="${p.filename}" alt="${escapeHtml(p.label)}"><span>${escapeHtml(p.label)}</span></div>`).join('')
        : '<div class="photo-card" style="display:flex;align-items:center;justify-content:center;color:var(--ink-faint);font-size:12px;">No photos yet</div>'}
    </div>

    <div class="card"><h3>🕒 Opening hours</h3>${hoursTable(b.hours)}</div>

    <div class="card">
      <h3>Location confidence</h3>
      <div class="confidence-row">
        <div class="confidence-num">${b.confidence || 0}%</div>
        <div style="flex:1;">
          <div class="confidence-bar"><div class="confidence-fill" style="width:${Math.max(0, Math.min(100, Number(b.confidence) || 0))}%;"></div></div>
          <div class="confidence-meta">${b.successful_visits || 0} successful visits reported</div>
        </div>
      </div>
      <div class="arrival-row">
        <span style="font-size:13px;font-weight:700;">Did you find this business?</span>
        <button class="btn small" id="arriveYes">✓ Yes</button>
        <button class="btn small ghost" id="arriveNo">✗ No</button>
      </div>
    </div>

    <div class="card">
      <h3>Reviews</h3>
      ${b.reviews && b.reviews.length ? b.reviews.map((r) => `
        <div class="review" data-review-id="${r.id}">
          <div class="review-top"><span>${escapeHtml(r.user_name)} <span class="review-date">${new Date(r.created_at * 1000).toLocaleDateString()}</span></span><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span></div>
          <div class="review-text">${escapeHtml(r.text)}</div>
          ${r.photo ? `<img src="${r.photo}" style="max-width:150px;border-radius:10px;margin-top:8px;">` : ''}
          <div style="margin-top:8px;display:flex;gap:10px;">
            <button class="btn small ghost helpful-btn" data-id="${r.id}">👍 Helpful (${r.helpful_count})</button>
            ${isOwner && !r.owner_reply ? `<button class="btn small ghost reply-btn" data-id="${r.id}">Reply</button>` : ''}
          </div>
          ${r.owner_reply ? `<div class="owner-reply"><strong>Owner reply:</strong> ${escapeHtml(r.owner_reply)}</div>` : ''}
          ${isOwner && !r.owner_reply ? `<form class="reply-form hidden" data-id="${r.id}" style="margin-top:8px;"><textarea rows="2" required placeholder="Write a public reply…" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);"></textarea><button class="btn small" type="submit">Post reply</button></form>` : ''}
        </div>`).join('') : '<p class="muted" style="margin:0;">No reviews yet — be the first.</p>'}
      ${user ? `
        <form id="reviewForm" style="margin-top:16px;" enctype="multipart/form-data">
          <div class="field-grid">
            <div class="field"><label>Rating</label><select id="rv-rating"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select></div>
            <div class="field"><label>Photo (optional)</label><input type="file" id="rv-photo" accept="image/*"></div>
          </div>
          <div class="field"><label>Review</label><textarea id="rv-text" rows="2" required></textarea></div>
          <button class="btn" type="submit">Post review</button>
        </form>` : `<p class="note">Please <a href="login.html?next=business.html%3Fid%3D${b.id}" style="text-decoration:underline;">log in</a> to leave a review.</p>`}
    </div>

    <div class="card">
      <h3>Questions &amp; Answers</h3>
      <div id="qaList"><div class="loading">Loading…</div></div>
      ${user ? `<form id="qaForm" style="margin-top:14px;"><div class="field"><label>Ask a question</label><textarea id="qa-question" rows="2" required></textarea></div><button class="btn small">Ask</button></form>` : `<p class="note">Log in to ask a question.</p>`}
    </div>
  `;

  wireActions(b, user, isOwner);
}

/* ============================= ACTIONS ============================= */

function wireActions(b, user, isOwner) {
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try {
      if (saved) { await api('/saved/' + b.id, { method: 'DELETE' }); saved = false; toast('Removed from saved.'); }
      else { await api('/saved/' + b.id, { method: 'POST' }); saved = true; toast('Saved.'); }
      render(b); initProfileMap(b); loadQA(b.id);
    } catch (e) { toast(e.message); }
  });

  document.getElementById('shareBtn').addEventListener('click', async () => {
    const url = window.location.href;
    api('/businesses/' + b.id + '/track', { method: 'POST', body: { type: 'share' } }).catch(() => {});
    if (navigator.share) navigator.share({ title: b.name, url }).catch(() => {});
    else { await navigator.clipboard.writeText(url).catch(() => {}); toast('Link copied.'); }
  });

  document.getElementById('reportBtn').addEventListener('click', async () => {
    const reason = prompt('What seems wrong with this listing?');
    if (!reason) return;
    try { await api('/businesses/' + b.id + '/report', { method: 'POST', body: { reason } }); toast('Thanks — our team will review this.'); }
    catch (e) { toast(e.message); }
  });

  const claimBtn = document.getElementById('claimBtn');
  if (claimBtn) claimBtn.addEventListener('click', async () => {
    const message = prompt('Tell us why you believe you own this business:');
    if (message === null) return;
    try { const r = await api('/businesses/' + b.id + '/claim', { method: 'POST', body: { message } }); toast(r.message); }
    catch (e) { toast(e.message); }
  });

  document.getElementById('arriveYes').addEventListener('click', async () => {
    try { const { business } = await api('/businesses/' + b.id + '/arrival', { method: 'POST', body: { found: true } }); toast('Glad you found it!'); render(business); initProfileMap(business); loadQA(business.id); }
    catch (e) { toast(e.message); }
  });
  document.getElementById('arriveNo').addEventListener('click', async () => {
    try { const { business } = await api('/businesses/' + b.id + '/arrival', { method: 'POST', body: { found: false } }); toast('Thanks — this helps us improve directions.'); render(business); initProfileMap(business); loadQA(business.id); }
    catch (e) { toast(e.message); }
  });

  document.querySelectorAll('.helpful-btn').forEach((btn) => btn.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try { const { business } = await api('/reviews/' + btn.dataset.id + '/helpful', { method: 'POST' }); render(business); initProfileMap(business); loadQA(business.id); }
    catch (e) { toast(e.message); }
  }));
  document.querySelectorAll('.reply-btn').forEach((btn) => btn.addEventListener('click', () => {
    const form = document.querySelector(`.reply-form[data-id="${btn.dataset.id}"]`);
    if (form) form.classList.remove('hidden');
  }));
  document.querySelectorAll('.reply-form').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reply = form.querySelector('textarea').value.trim();
    if (!reply) return;
    try { const { business } = await api('/reviews/' + form.dataset.id + '/reply', { method: 'PUT', body: { reply } }); toast('Reply posted.'); render(business); initProfileMap(business); loadQA(business.id); }
    catch (e) { toast(e.message); }
  }));

  const reviewForm = document.getElementById('reviewForm');
  if (reviewForm) reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = document.getElementById('rv-rating').value;
    const text = document.getElementById('rv-text').value.trim();
    const photoInput = document.getElementById('rv-photo');
    const photoFile = photoInput && photoInput.files ? photoInput.files[0] : null;
    if (!text) return;
    const fd = new FormData();
    fd.append('rating', rating); fd.append('text', text);
    if (photoFile) fd.append('photo', photoFile);
    try { const { business } = await api('/reviews/business/' + b.id, { method: 'POST', body: fd }); toast('Review posted.'); render(business); initProfileMap(business); loadQA(business.id); }
    catch (e) { toast(e.message); }
  });

  const qaForm = document.getElementById('qaForm');
  if (qaForm) qaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('qa-question');
    const question = input.value.trim();
    if (!question) return;
    try { await api('/qa/business/' + b.id, { method: 'POST', body: { question } }); toast('Question posted.'); input.value = ''; loadQA(b.id); }
    catch (e) { toast(e.message); }
  });

  document.getElementById('navigateBtn').addEventListener('click', () => startNavigation(b));
}

async function loadQA(businessId) {
  const el = document.getElementById('qaList');
  if (!el) return;
  try {
    const { questions } = await api('/qa/business/' + businessId);
    if (!questions.length) { el.innerHTML = '<p class="muted" style="margin:0;">No questions yet.</p>'; return; }
    el.innerHTML = questions.map((q) => `
      <div class="review">
        <div class="review-top"><span>${escapeHtml(q.user_name)} asked <span class="review-date">${new Date(q.created_at * 1000).toLocaleDateString()}</span></span></div>
        <div class="review-text"><strong>Q:</strong> ${escapeHtml(q.question)}</div>
        ${q.answers.map((a) => `<div class="review-text" style="margin-top:4px;padding-left:10px;border-left:2px solid var(--line);"><strong>${a.is_owner ? 'Owner' : escapeHtml(a.user_name)}:</strong> ${escapeHtml(a.answer)}</div>`).join('')}
        ${getUser() ? `<form class="qa-answer-form" data-id="${q.id}" style="margin-top:8px;display:flex;gap:6px;"><input type="text" placeholder="Write an answer…" style="flex:1;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg-raised);color:var(--ink);"><button class="btn small">Reply</button></form>` : ''}
      </div>`).join('');
    el.querySelectorAll('.qa-answer-form').forEach((form) => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const answer = input.value.trim();
      if (!answer) return;
      try { await api('/qa/' + form.dataset.id + '/answers', { method: 'POST', body: { answer } }); input.value = ''; loadQA(businessId); }
      catch (err) { toast(err.message); }
    }));
  } catch (e) { el.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`; }
}

/* ============================= PROFILE MAP (small, static) ============================= */

function destinationIcon() {
  return L.divIcon({
    className: '', iconSize: [34, 42], iconAnchor: [17, 40],
    html: `<div style="width:34px;height:42px;">
      <svg width="34" height="42" viewBox="0 0 34 42"><path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 25 17 25s17-12.3 17-25C34 7.6 26.4 0 17 0z" fill="#FF5A1F"/><circle cx="17" cy="17" r="7" fill="#fff"/></svg>
    </div>`,
  });
}

function initProfileMap(b) {
  const el = document.getElementById('map');
  if (!el || typeof L === 'undefined') return;
  if (profileMap) { try { profileMap.remove(); } catch (e) {} profileMap = null; }
  profileMap = L.map('map', { zoomControl: true }).setView([Number(b.lat), Number(b.lng)], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(profileMap);
  L.marker([Number(b.lat), Number(b.lng)], { icon: destinationIcon() }).addTo(profileMap).bindPopup(`<strong>${escapeHtml(b.name)}</strong>`);
  setTimeout(() => { if (profileMap) profileMap.invalidateSize(true); }, 200);
}

load();
