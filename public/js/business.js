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
  document.getElementById('profileMain').innerHTML = skeletonCards(3); // Feature: skeleton loader instead of a blank pane while the profile loads
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
    loadNearby(business);
  } catch (e) {
    document.getElementById('profileMain').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

// Feature: nearby similar businesses (same category), like the "you might
// also like" row on Uber Eats or Amazon — reuses the existing search
// endpoint, no new backend work.
async function loadNearby(b) {
  const mount = document.getElementById('nearbyMount');
  if (!mount) return;
  try {
    const params = new URLSearchParams({ category: b.category, lat: b.lat, lng: b.lng, sort: 'nearest' });
    const { businesses } = await api('/businesses?' + params.toString());
    const others = businesses.filter((x) => x.id !== b.id).slice(0, 6);
    if (!others.length) return;
    mount.innerHTML = `<h3 style="margin-bottom:10px;">More in ${escapeHtml(b.category)}</h3>
      <div class="nearby-strip">${others.map((o) => `
        <a class="nearby-card" href="business.html?id=${o.id}">
          <strong>${escapeHtml(o.name)}</strong>
          <span class="muted">${o.distanceKm != null ? o.distanceKm.toFixed(1) + ' km' : escapeHtml(o.building || '')}</span>
          ${o.avgRating ? `<span class="stars small">★ ${o.avgRating}</span>` : ''}
        </a>`).join('')}</div>`;
  } catch (e) {}
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

// Feature: "closing soon" warning — Uber/food-delivery apps flag urgency
// like this ("last orders in 20 min"); a plain OPEN/CLOSED badge doesn't
// tell you that you're about to be too late.
const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function closingSoonBanner(b) {
  if (!b.hours || b.openNow !== true) return '';
  const now = new Date();
  const today = b.hours[DOW_KEYS[now.getDay()]];
  if (!today) return '';
  const [, endStr] = today;
  const [eh, em] = endStr.split(':').map(Number);
  const end = new Date(now); end.setHours(eh, em, 0, 0);
  const minsLeft = Math.round((end - now) / 60000);
  if (minsLeft > 0 && minsLeft <= 30) return `<div class="closing-soon-banner">⏰ Closing in ${minsLeft} min</div>`;
  return '';
}

// Feature: rating breakdown bars (5★ down to 1★), like Uber driver
// ratings or Amazon reviews — computed client-side from the reviews
// already loaded, no extra request needed.
function ratingBreakdown(reviews) {
  const counts = [0, 0, 0, 0, 0]; // index 0 = 5 star ... index 4 = 1 star
  reviews.forEach((r) => { const i = 5 - Math.round(r.rating); if (counts[i] !== undefined) counts[i]++; });
  const total = reviews.length;
  return `<div class="rating-breakdown">${counts.map((c, i) => `
    <div class="rb-row"><span class="rb-star">${5 - i}★</span><div class="rb-track"><div class="rb-fill" style="width:${total ? (c / total) * 100 : 0}%;"></div></div><span class="rb-count">${c}</span></div>`).join('')}</div>`;
}

/* ============================= RENDER ============================= */

function render(b) {
  // Fix: call/WhatsApp links normalized to real international format —
  // previously used whatever was typed verbatim, which silently failed
  // for WhatsApp (wa.me requires a country code, no leading zero) on any
  // number saved before the country-code fields existed.
  const phoneLink = normalizePhoneForLink(b.phone);
  const waNum = normalizePhoneForLink(b.whatsapp).replace(/[^0-9]/g, '');
  const user = getUser();
  const isOwner = user && user.id === b.owner_id;
  const pageUrl = window.location.origin + '/business.html?id=' + b.id;

  // Site-wide features: dynamic page title/description + rich search
  // preview data + a breadcrumb trail, for this specific business.
  setPageMeta(b.name + ' — ' + b.category + ' — Aliko', (b.description || `${b.name} on Aliko — exact location, hours and directions.`).slice(0, 155));
  injectJSONLD({
    '@context': 'https://schema.org', '@type': 'LocalBusiness',
    name: b.name, description: b.description || undefined, telephone: b.phone || undefined,
    address: { '@type': 'PostalAddress', streetAddress: [b.building, b.floor ? 'Floor ' + b.floor : ''].filter(Boolean).join(', ') },
    geo: { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng },
    aggregateRating: b.avgRating ? { '@type': 'AggregateRating', ratingValue: b.avgRating, reviewCount: b.reviews.length } : undefined,
    url: pageUrl,
  });

  document.getElementById('profileMain').innerHTML = `
    <button class="back-link" onclick="window.location.href='index.html'">← Back to Discover</button>
    <nav class="aliko-breadcrumb" id="bizBreadcrumb"></nav>

    <div class="profile-top">
      <div>
        <h1 class="profile-name">${escapeHtml(b.name)} ${tierBadge(b)} ${b.openNow === true ? '<span class="badge open">OPEN NOW</span>' : b.openNow === false ? '<span class="badge closed">CLOSED</span>' : ''}</h1>
        <div class="profile-meta">${escapeHtml(b.category)} ${b.avgRating ? `· <span class="stars">${'★'.repeat(Math.round(b.avgRating))}</span> ${b.avgRating} (${b.reviews.length})` : '· No reviews yet'}</div>
        ${b.tags && b.tags.length ? `<div class="chip-row" style="margin:10px 0 0;">${b.tags.map((t) => `<span class="chip tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="icon-btn" id="saveBtn" title="Save">${saved ? '★' : '☆'}</button>
        <button class="icon-btn" id="shareBtn" title="Share">🔗</button>
        <button class="icon-btn" id="printBtn" title="Print">🖨</button>
        <button class="icon-btn" id="qrBtn" title="QR code">▦</button>
      </div>
    </div>
    <div class="qr-panel hidden" id="qrPanel"></div>

    <p class="profile-desc">${escapeHtml(b.description || 'No description provided yet.')}</p>

    ${b.offers && b.offers.length ? `<div class="card" style="border-color:var(--signal-amber);">
      <h3>🏷 Active deals</h3>
      ${b.offers.map((o) => `<div style="margin-bottom:10px;" class="deal-row" data-title="${escapeHtml(o.title)}" data-ends="${o.ends_at * 1000}"><strong>${escapeHtml(o.title)}</strong> ${o.discount ? '— ' + escapeHtml(o.discount) : ''}<div class="muted" style="font-size:12.5px;">${escapeHtml(o.description || '')} Ends ${new Date(o.ends_at * 1000).toLocaleDateString()}</div><button class="btn ghost small deal-remind-btn">📅 Remind me</button></div>`).join('')}
    </div>` : ''}

    ${b.brand ? `<p class="note">Part of <strong>${escapeHtml(b.brand.name)}</strong>${b.otherLocations && b.otherLocations.length ? ' — also at: ' + b.otherLocations.map((l) => escapeHtml(l.name) + ' (' + escapeHtml(l.building) + ')').join(', ') : ''}</p>` : ''}

    <div class="action-row">
      <a class="btn" href="tel:${escapeHtml(phoneLink)}">📞 Call</a>
      ${waNum ? `<a class="btn" href="https://wa.me/${waNum}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      ${b.phone ? `<button class="btn ghost" id="copyPhoneBtn">📋 Copy phone</button>` : ''}
      <button class="btn ghost" id="copyAddrBtn">📋 Copy address</button>
      <button class="btn ghost" id="copyLinkBtn">🔗 Copy link</button>
      ${isOwner ? `<button class="btn ghost" id="embedBtn">＜／＞ Get embed code</button>` : ''}
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

    <div class="card"><h3>🕒 Opening hours</h3>${closingSoonBanner(b)}${hoursTable(b.hours)}</div>

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
      ${b.reviews && b.reviews.length ? ratingBreakdown(b.reviews) : ''}
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

    <div id="nearbyMount"></div>

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
    shareOrCopy({ title: b.name, url });
  });

  document.getElementById('copyAddrBtn').addEventListener('click', () => {
    copyToClipboard([b.building, b.floor ? 'Floor ' + b.floor : '', b.shop ? 'Shop ' + b.shop : ''].filter(Boolean).join(', '), 'Address');
  });
  if (document.getElementById('copyPhoneBtn')) document.getElementById('copyPhoneBtn').addEventListener('click', () => copyToClipboard(normalizePhoneForLink(b.phone), 'Phone number'));
  document.getElementById('copyLinkBtn').addEventListener('click', () => copyToClipboard(window.location.href, 'Link'));
  document.getElementById('printBtn').addEventListener('click', printPage);

  document.getElementById('qrBtn').addEventListener('click', () => {
    const panel = document.getElementById('qrPanel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    panel.innerHTML = `<img src="${qrCodeUrl(window.location.href)}" alt="QR code linking to this business" width="180" height="180"><p class="muted" style="font-size:12px;">Scan to open this listing</p>`;
    panel.classList.remove('hidden');
  });

  const embedBtn = document.getElementById('embedBtn');
  if (embedBtn) embedBtn.addEventListener('click', () => copyToClipboard(embedCodeFor(b.id, b.name), 'Embed code'));

  document.querySelectorAll('.deal-remind-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.deal-row');
      const ends = Number(row.dataset.ends);
      downloadICS({ title: row.dataset.title + ' — ' + b.name, start: ends - 3600000, end: ends, location: b.building || b.name });
    });
  });

  renderBreadcrumb(document.getElementById('bizBreadcrumb'), [
    { href: 'index.html', label: 'Discover' },
    { href: 'index.html?category=' + encodeURIComponent(b.category || ''), label: b.category || 'Category' },
    { label: b.name },
  ]);

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
  if (reviewForm) {
    // Interactive star-rating input on top of the existing <select> —
    // clicking a star sets the select's value, so submission logic below
    // is untouched; it's a progressive enhancement, not a replacement.
    const ratingSelect = document.getElementById('rv-rating');
    if (ratingSelect) {
      ratingSelect.style.display = 'none';
      const starWrap = document.createElement('div');
      starWrap.className = 'aliko-star-input';
      starWrap.innerHTML = [5, 4, 3, 2, 1].map((n) => `<span data-val="${n}">★</span>`).join('');
      ratingSelect.parentNode.insertBefore(starWrap, ratingSelect);
      const paint = (val) => starWrap.querySelectorAll('span').forEach((s) => s.classList.toggle('filled', Number(s.dataset.val) <= val));
      paint(5);
      starWrap.querySelectorAll('span').forEach((s) => s.addEventListener('click', () => { ratingSelect.value = s.dataset.val; paint(Number(s.dataset.val)); }));
    }
    // Live thumbnail preview of the chosen review photo before upload.
    const photoInput = document.getElementById('rv-photo');
    if (photoInput) {
      photoInput.addEventListener('change', () => {
        const old = reviewForm.querySelector('.review-photo-preview');
        if (old) old.remove();
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        const img = document.createElement('img');
        img.className = 'review-photo-preview';
        img.src = URL.createObjectURL(file);
        photoInput.insertAdjacentElement('afterend', img);
      });
    }
  }
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

/* =====================================================================
   NAVIGATION — full-screen turn-by-turn, powered by /api/directions
   (which itself talks to your configured OSRM_URL server-side)
   ===================================================================== */

const NAV = {
  map: null, mapReady: false,
  puckEl: null, puckMarker: null, destMarker: null,
  watchId: null, active: false,
  route: null, coords: [], steps: [], stepIndex: 0, progressIndex: 0,
  altRoute: null, altCoords: null,
  lastRouteAt: 0, rerouting: false, userMovedMap: false,
  speech: false, lastSpoken: '', spokenThresholds: null,
  gpsWarnTimer: null, lastGpsAt: 0, firstFixAt: 0, flowTimer: null, beaconTimer: null,
  currentLat: null, currentLng: null, currentBearing: 0,
  animLat: null, animLng: null, animBearing: 0, animRaf: null,
  headingUp: true, pitchOn: true,
  profile: 'foot', batterySaver: false, finalApproachShown: false,
};

const ARRIVAL_M = 30;
const OFF_ROUTE_M = 45;
const STEP_ADVANCE_M = 28;
const REROUTE_COOLDOWN_MS = 5000;
const FINAL_APPROACH_M = 60;
// Rough walking speed used only when a route's duration wasn't measured for
// walking (e.g. the routing backend only has a driving profile available).
// This is what actually fixes "no real distance estimate" for people on
// foot: a driving-profile duration is worthless for a pedestrian ETA.
const WALK_SPEED_MPS = 1.35; // ~4.9 km/h, average adult walking pace

// Free vector basemap (OpenFreeMap, no API key). We use the *dark* style —
// not the default light "liberty" one — because it matches Aliko's dark UI
// and is what actually makes the 3D buildings read as buildings instead of
// washed-out pale/white shapes. Buildings get real extruded heights from
// the same underlying tile data either way.
// Free vector basemap (OpenFreeMap, no API key). Using "liberty" — a full
// colourful cartographic style, not the flat "dark" one — because it's
// what actually makes a map pleasant and fast to read at a glance: proper
// road-colour hierarchy, green parks, blue water, and built-in icons for
// points of interest (including mosques, churches, and other places of
// worship) that a plain dark basemap doesn't render at all.
const NAV_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function startNavigation(b) {
  if (!navigator.geolocation) { toast('Geolocation is not available in this browser.'); return; }
  currentBusiness_forNav = b;
  resetNav();
  NAV.active = true;
  document.getElementById('navPanel').classList.remove('hidden');
  document.body.classList.add('nav-open');
  document.getElementById('navAcquiring').classList.remove('hidden');
  document.getElementById('navFinalApproach').classList.add('hidden');
  setNavInstruction('depart', 0, 'Finding your position…', '', '—');
  document.getElementById('navDestName').textContent = b.name;
  document.getElementById('navDestAddr').textContent = [b.building, b.floor ? 'Floor ' + b.floor : '', b.shop ? 'Shop ' + b.shop : ''].filter(Boolean).join(' · ');
  setProfileButtons();

  setTimeout(() => initNavMap(b), 50);

  api('/businesses/' + b.id + '/track', { method: 'POST', body: { type: 'navigation' } }).catch(() => {});
  // Non-critical work deferred off the main thread's idle time, so it
  // doesn't compete with map init / first paint for CPU.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(() => fetchDestinationWeather(b));
  idle(() => setupBatteryAwareness());

  // A quick low-accuracy fix (usually cell/wifi, near-instant) so the map
  // and puck appear right away, instead of a blank screen while the phone
  // waits for a full GPS lock. watchPosition below then refines it.
  navigator.geolocation.getCurrentPosition(onGpsUpdate, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 3000 });

  NAV.lastGpsAt = Date.now();
  startWatch();
  clearTimeout(NAV.gpsWarnTimer);
  NAV.gpsWarnTimer = setTimeout(gpsWatchdog, 7000);
}

function startWatch() {
  if (NAV.watchId !== null) { try { navigator.geolocation.clearWatch(NAV.watchId); } catch (e) {} }
  const opts = NAV.batterySaver
    ? { enableHighAccuracy: false, maximumAge: 4000, timeout: 20000 }
    : { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 };
  NAV.watchId = navigator.geolocation.watchPosition(onGpsUpdate, onGpsError, opts);
}

// Feature: battery-aware GPS. High-accuracy GPS watching is one of the
// biggest battery drains on a phone. If the device is low on charge and
// not plugged in, we drop to a lower-power location mode automatically
// (fewer, less precise fixes) and show a small indicator — most nav apps
// just keep draining your battery regardless.
function setupBatteryAwareness() {
  if (!navigator.getBattery) return;
  navigator.getBattery().then((battery) => {
    const evaluate = () => {
      const shouldSave = battery.level <= 0.2 && !battery.charging;
      if (shouldSave !== NAV.batterySaver) {
        NAV.batterySaver = shouldSave;
        const chip = document.getElementById('navBatteryChip');
        if (chip) chip.classList.toggle('hidden', !shouldSave);
        if (NAV.active) startWatch();
      }
    };
    evaluate();
    battery.addEventListener('levelchange', evaluate);
    battery.addEventListener('chargingchange', evaluate);
  }).catch(() => {});
}

// Feature: weather-aware destination banner, via Open-Meteo (free, no API
// key, no signup). Google Maps doesn't tell you it's about to rain where
// you're headed — we do.
async function fetchDestinationWeather(b) {
  const chip = document.getElementById('navWeatherChip');
  if (!chip) return;
  chip.classList.add('hidden');
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${b.lat}&longitude=${b.lng}&current=temperature_2m,precipitation,weather_code&timezone=auto`;
    const resp = await fetch(url);
    const data = await resp.json();
    const cur = data && data.current;
    if (!cur) return;
    const { emoji, label } = weatherLabel(cur.weather_code);
    const temp = Math.round(cur.temperature_2m);
    chip.textContent = `${emoji} ${temp}°C · ${label}`;
    chip.classList.remove('hidden');
    if (cur.precipitation > 0) showBanner(`${emoji} ${label} expected near your destination — plan ahead.`);
  } catch (e) {}
}
function weatherLabel(code) {
  if (code === 0) return { emoji: '☀️', label: 'Clear' };
  if (code <= 2) return { emoji: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', label: 'Overcast' };
  if (code >= 45 && code <= 48) return { emoji: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 67) return { emoji: '🌦️', label: 'Rain' };
  if (code >= 71 && code <= 77) return { emoji: '🌨️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { emoji: '🌧️', label: 'Showers' };
  if (code >= 95) return { emoji: '⛈️', label: 'Thunderstorm' };
  return { emoji: '🌡️', label: 'Mild' };
}

// Feature: Walk / Drive mode. Switches the routing profile *and* guarantees
// a realistic duration even if the backend only has a driving profile
// available (see computeRoute's fallback), instead of showing a driving
// ETA to someone on foot.
function setProfile(p) {
  if (NAV.profile === p) return;
  NAV.profile = p;
  setProfileButtons();
  if (NAV.currentLat !== null) {
    NAV.route = null; NAV.altRoute = null;
    computeRoute(NAV.currentLat, NAV.currentLng, currentBusiness_forNav.lat, currentBusiness_forNav.lng, { alternatives: true });
  }
}
function setProfileButtons() {
  const walkBtn = document.getElementById('navProfileWalk'), driveBtn = document.getElementById('navProfileDrive');
  if (walkBtn) walkBtn.classList.toggle('active', NAV.profile === 'foot');
  if (driveBtn) driveBtn.classList.toggle('active', NAV.profile === 'driving');
}

function initNavMap(b) {
  if (typeof maplibregl === 'undefined') { toast('Map engine failed to load — check your connection.'); return; }
  NAV.map = new maplibregl.Map({
    container: 'navMap', style: NAV_STYLE,
    center: [Number(b.lng), Number(b.lat)], zoom: 16.5, pitch: 55, bearing: 0,
    attributionControl: { compact: true },
  });
  NAV.map.on('dragstart', () => { NAV.userMovedMap = true; });
  NAV.map.on('rotate', () => updateCompass(NAV.map.getBearing()));

  NAV.map.on('load', () => {
    NAV.mapReady = true;
    applyAlikoTheme();
    add3DBuildings();
    addSky();
    addRouteLayers();
    addAccuracyLayer();
    addDestinationMarker(b);
    addDestinationBeacon(b);
    NAV.map.resize();
    if (NAV.currentLat !== null) animatePuckTo(NAV.currentLat, NAV.currentLng, NAV.currentLat, NAV.currentLng, NAV.currentBearing);
  });
}

// =====================================================================
// ALIKO CARTOGRAPHIC THEME
// A genuinely custom re-theme of the "liberty" basemap's exact layers
// (fetched and inspected directly, not guessed), built around the brand's
// own design principle from style.css: near-neutral surfaces, ONE signal
// color (route-orange) reserved for wayfinding — nothing else on the map
// competes with it. Roads/labels use a warm stone/charcoal family instead
// of liberty's stock warm-orange road palette, specifically so nothing on
// the base map fights the live orange route line for attention. This is
// applied as paint overrides on the real "liberty" style at runtime — no
// new tile vendor, no hosting of a separate style file, same free tiles.
// =====================================================================
const ALIKO_MAP_COLORS = {
  bg: '#F7F2EA',
  park: '#DCE6CE', parkOutline: 'rgba(190,206,164,1)',
  landuseResidential: 'hsla(35,30%,88%,0.55)',
  wood: 'hsla(100,30%,55%,0.32)', grass: 'rgba(196,214,176,0.4)', sand: '#F3E7C9',
  pitch: '#E3DEC9', cemetery: '#D8E0C4', hospital: '#FADCE0', school: '#F0ECC9', aeroway: '#E8E2D4',
  water: '#A7C4E0', waterLine: '#8FB3D9', waterLabel: '#4A6B8A',
  building: '#E4DACB', buildingOutline: '#C9BBA0',
  roadMotorway: '#4A4238', roadMotorwayCasing: '#6B6153',
  roadTrunkPrimary: '#6B6153', roadTrunkPrimaryCasing: '#8A8070',
  roadSecTert: '#8A8070', roadSecTertCasing: '#A89C87',
  roadMinor: '#FBF8F2', roadMinorCasing: '#D8CFBE',
  roadLink: '#B4A88F', roadLinkCasing: '#C9BEA6',
  roadPath: '#F0EAD9', roadPathCasing: '#DCD3BE',
  roadService: '#DAD2C2', roadServiceCasing: '#C7BEA9',
  rail: '#9C9284',
  boundary: '#B9A9D9',
  poiText: '#4A4238', placeText: '#332B20', labelHalo: '#F7F2EA',
};

// Exact road-layer ids from the live "liberty" style.json, mapped to the
// brand's road-hierarchy colors above. Hand-mapped rather than pattern-
// matched because the source style names casing/fill layers inconsistently
// between tunnel/road/bridge variants (e.g. "bridge_street" vs "road_minor"
// for the same road class) — a guessed pattern would miss some.
const ALIKO_ROAD_LINE_COLORS = {
  tunnel_motorway_link_casing: ALIKO_MAP_COLORS.roadLinkCasing,
  tunnel_service_track_casing: ALIKO_MAP_COLORS.roadServiceCasing,
  tunnel_link_casing: ALIKO_MAP_COLORS.roadLinkCasing,
  tunnel_street_casing: ALIKO_MAP_COLORS.roadMinorCasing,
  tunnel_secondary_tertiary_casing: ALIKO_MAP_COLORS.roadSecTertCasing,
  tunnel_trunk_primary_casing: ALIKO_MAP_COLORS.roadTrunkPrimaryCasing,
  tunnel_motorway_casing: ALIKO_MAP_COLORS.roadMotorwayCasing,
  tunnel_path_pedestrian: ALIKO_MAP_COLORS.roadPath,
  tunnel_motorway_link: ALIKO_MAP_COLORS.roadLink,
  tunnel_service_track: ALIKO_MAP_COLORS.roadService,
  tunnel_link: ALIKO_MAP_COLORS.roadLink,
  tunnel_minor: ALIKO_MAP_COLORS.roadMinor,
  tunnel_secondary_tertiary: ALIKO_MAP_COLORS.roadSecTert,
  tunnel_trunk_primary: ALIKO_MAP_COLORS.roadTrunkPrimary,
  tunnel_motorway: ALIKO_MAP_COLORS.roadMotorway,
  tunnel_major_rail: ALIKO_MAP_COLORS.rail, tunnel_major_rail_hatching: ALIKO_MAP_COLORS.rail,
  tunnel_transit_rail: ALIKO_MAP_COLORS.rail, tunnel_transit_rail_hatching: ALIKO_MAP_COLORS.rail,

  road_motorway_link_casing: ALIKO_MAP_COLORS.roadLinkCasing,
  road_service_track_casing: ALIKO_MAP_COLORS.roadServiceCasing,
  road_link_casing: ALIKO_MAP_COLORS.roadLinkCasing,
  road_minor_casing: ALIKO_MAP_COLORS.roadMinorCasing,
  road_secondary_tertiary_casing: ALIKO_MAP_COLORS.roadSecTertCasing,
  road_trunk_primary_casing: ALIKO_MAP_COLORS.roadTrunkPrimaryCasing,
  road_motorway_casing: ALIKO_MAP_COLORS.roadMotorwayCasing,
  road_path_pedestrian: ALIKO_MAP_COLORS.roadPath,
  road_motorway_link: ALIKO_MAP_COLORS.roadLink,
  road_service_track: ALIKO_MAP_COLORS.roadService,
  road_link: ALIKO_MAP_COLORS.roadLink,
  road_minor: ALIKO_MAP_COLORS.roadMinor,
  road_secondary_tertiary: ALIKO_MAP_COLORS.roadSecTert,
  road_trunk_primary: ALIKO_MAP_COLORS.roadTrunkPrimary,
  road_motorway: ALIKO_MAP_COLORS.roadMotorway,
  road_major_rail: ALIKO_MAP_COLORS.rail, road_major_rail_hatching: ALIKO_MAP_COLORS.rail,
  road_transit_rail: ALIKO_MAP_COLORS.rail, road_transit_rail_hatching: ALIKO_MAP_COLORS.rail,

  bridge_motorway_link_casing: ALIKO_MAP_COLORS.roadLinkCasing,
  bridge_service_track_casing: ALIKO_MAP_COLORS.roadServiceCasing,
  bridge_link_casing: ALIKO_MAP_COLORS.roadLinkCasing,
  bridge_street_casing: ALIKO_MAP_COLORS.roadMinorCasing,
  bridge_path_pedestrian_casing: ALIKO_MAP_COLORS.roadPathCasing,
  bridge_secondary_tertiary_casing: ALIKO_MAP_COLORS.roadSecTertCasing,
  bridge_trunk_primary_casing: ALIKO_MAP_COLORS.roadTrunkPrimaryCasing,
  bridge_motorway_casing: ALIKO_MAP_COLORS.roadMotorwayCasing,
  bridge_path_pedestrian: ALIKO_MAP_COLORS.roadPath,
  bridge_motorway_link: ALIKO_MAP_COLORS.roadLink,
  bridge_service_track: ALIKO_MAP_COLORS.roadService,
  bridge_link: ALIKO_MAP_COLORS.roadLink,
  bridge_street: ALIKO_MAP_COLORS.roadMinor,
  bridge_secondary_tertiary: ALIKO_MAP_COLORS.roadSecTert,
  bridge_trunk_primary: ALIKO_MAP_COLORS.roadTrunkPrimary,
  bridge_motorway: ALIKO_MAP_COLORS.roadMotorway,
  bridge_major_rail: ALIKO_MAP_COLORS.rail, bridge_major_rail_hatching: ALIKO_MAP_COLORS.rail,
  bridge_transit_rail: ALIKO_MAP_COLORS.rail, bridge_transit_rail_hatching: ALIKO_MAP_COLORS.rail,
};

function trySetPaint(id, prop, value) {
  try { NAV.map.setPaintProperty(id, prop, value); } catch (e) {}
}

function applyAlikoTheme() {
  const C = ALIKO_MAP_COLORS;
  try {
    Object.entries(ALIKO_ROAD_LINE_COLORS).forEach(([id, color]) => trySetPaint(id, 'line-color', color));

    trySetPaint('background', 'background-color', C.bg);
    trySetPaint('park', 'fill-color', C.park);
    trySetPaint('park', 'fill-outline-color', C.parkOutline);
    trySetPaint('park_outline', 'line-color', C.parkOutline);
    trySetPaint('landuse_residential', 'fill-color', C.landuseResidential);
    trySetPaint('landcover_wood', 'fill-color', C.wood);
    trySetPaint('landcover_grass', 'fill-color', C.grass);
    trySetPaint('landcover_sand', 'fill-color', C.sand);
    trySetPaint('landuse_pitch', 'fill-color', C.pitch);
    trySetPaint('landuse_track', 'fill-color', C.pitch);
    trySetPaint('landuse_cemetery', 'fill-color', C.cemetery);
    trySetPaint('landuse_hospital', 'fill-color', C.hospital);
    trySetPaint('landuse_school', 'fill-color', C.school);
    trySetPaint('aeroway_fill', 'fill-color', C.aeroway);
    trySetPaint('aeroway_runway', 'line-color', C.aeroway);
    trySetPaint('aeroway_taxiway', 'line-color', C.aeroway);

    trySetPaint('waterway_tunnel', 'line-color', C.waterLine);
    trySetPaint('waterway_river', 'line-color', C.waterLine);
    trySetPaint('waterway_other', 'line-color', C.waterLine);
    trySetPaint('water', 'fill-color', C.water);
    trySetPaint('waterway_line_label', 'text-color', C.waterLabel);
    trySetPaint('water_name_point_label', 'text-color', C.waterLabel);
    trySetPaint('water_name_line_label', 'text-color', C.waterLabel);

    trySetPaint('building', 'fill-color', C.building);
    trySetPaint('building', 'fill-outline-color', C.buildingOutline);
    // Liberty's own 3D buildings layer is disabled — we add a richer one
    // (with height-based colour ramp + vertical shading) right after this.
    try { NAV.map.setLayoutProperty('building-3d', 'visibility', 'none'); } catch (e) {}

    trySetPaint('boundary_3', 'line-color', C.boundary);
    trySetPaint('boundary_2', 'line-color', C.boundary);
    trySetPaint('boundary_disputed', 'line-color', C.boundary);

    ['poi_r20', 'poi_r7', 'poi_r1', 'poi_transit', 'highway-name-path', 'highway-name-minor', 'highway-name-major'].forEach((id) => trySetPaint(id, 'text-color', C.poiText));
    ['label_other', 'label_village', 'label_town', 'label_state', 'label_city', 'label_city_capital', 'label_country_3', 'label_country_2', 'label_country_1'].forEach((id) => {
      trySetPaint(id, 'text-color', C.placeText);
      trySetPaint(id, 'text-halo-color', C.labelHalo);
    });
  } catch (e) {}
}

function add3DBuildings() {
  try {
    const layers = NAV.map.getStyle().layers || [];
    const labelLayer = layers.find((l) => l.type === 'symbol');
    NAV.map.addLayer({
      id: 'aliko-3d-buildings', source: 'openmaptiles', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14,
      paint: {
        // Same warm stone family as the 2D building fill above, so 2D and
        // 3D buildings read as one consistent material, not two styles.
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, '#CBBFA3', 30, '#B6A582', 80, '#9C8863', 160, '#7C6B4E'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.82,
        'fill-extrusion-vertical-gradient': true,
      },
    }, labelLayer ? labelLayer.id : undefined);
  } catch (e) {}
}

function addSky() {
  try {
    // Feature: time-of-day adaptive lighting. The same buildings look cold
    // and blue at night, warm and golden at dusk/dawn, bright at midday —
    // small touch, but it's the difference between a map that feels "live"
    // and one that's static regardless of when you open it.
    const hour = new Date().getHours();
    let light;
    if (hour >= 17 && hour < 20) light = { color: '#FFB37A', intensity: 0.55 };
    else if (hour >= 6 && hour < 17) light = { color: '#FFEFD8', intensity: 0.4 };
    else light = { color: '#8FA6FF', intensity: 0.22 };
    NAV.map.setLight({ anchor: 'map', color: light.color, intensity: light.intensity, position: [1.5, 90, 45] });
    NAV.map.addLayer({ id: 'aliko-sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 8 } });
  } catch (e) {}
}

// Feature: destination beacon. A soft ground halo plus a translucent
// vertical light beam at the exact destination point, visible from far
// away and through buildings — clearer than a flat pin, and something no
// generic maps app bothers to build for a single destination.
function addDestinationBeacon(b) {
  try {
    const lat = Number(b.lat), lng = Number(b.lng);
    NAV.map.addSource('dest-halo', { type: 'geojson', data: circlePolygon(lat, lng, 9) });
    NAV.map.addLayer({ id: 'dest-halo', type: 'fill', source: 'dest-halo', paint: { 'fill-color': '#FF5A1F', 'fill-opacity': 0.16 } });
    NAV.map.addSource('dest-beam', { type: 'geojson', data: circlePolygon(lat, lng, 2.2) });
    NAV.map.addLayer({ id: 'dest-beam', type: 'fill-extrusion', source: 'dest-beam', paint: { 'fill-extrusion-color': '#FF5A1F', 'fill-extrusion-height': 130, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.22 } });
    let t = 0;
    clearInterval(NAV.beaconTimer);
    NAV.beaconTimer = setInterval(() => {
      if (!NAV.map || !NAV.map.getLayer('dest-halo')) return;
      t += 0.12;
      const op = 0.1 + (Math.sin(t) + 1) * 0.09;
      try { NAV.map.setPaintProperty('dest-halo', 'fill-opacity', op); } catch (e) {}
    }, 90);
  } catch (e) {}
}

function addRouteLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  NAV.map.addSource('route-behind', { type: 'geojson', data: empty });
  NAV.map.addSource('route-ahead', { type: 'geojson', data: empty, lineMetrics: true });
  NAV.map.addSource('route-alt-src', { type: 'geojson', data: empty });

  NAV.map.addLayer({ id: 'route-alt', type: 'line', source: 'route-alt-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8FA6C9', 'line-width': 4, 'line-opacity': 0.55, 'line-dasharray': [2, 2] } });
  NAV.map.addLayer({ id: 'route-behind', type: 'line', source: 'route-behind', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6B7280', 'line-width': 5, 'line-opacity': 0.5 } });
  NAV.map.addLayer({ id: 'route-glow', type: 'line', source: 'route-ahead', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF5A1F', 'line-width': 20, 'line-blur': 8, 'line-opacity': 0.28 } });
  NAV.map.addLayer({ id: 'route-ahead', type: 'line', source: 'route-ahead', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 7, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#FFC58A', 0.5, '#FF5A1F', 1, '#C9440F'] } });
  NAV.map.addLayer({ id: 'route-flow', type: 'line', source: 'route-ahead', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [0, 4, 3] } });

  animateFlow();
}

// Cheap "flowing" route animation: cycle the dash pattern of a thin white
// line drawn over the route so it reads as a moving current toward the
// destination, the way premium nav apps signal "this way" at a glance.
const FLOW_STEPS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5]];
function animateFlow() {
  let i = 0;
  clearInterval(NAV.flowTimer);
  NAV.flowTimer = setInterval(() => {
    if (!NAV.map || !NAV.map.getLayer('route-flow')) return;
    i = (i + 1) % FLOW_STEPS.length;
    try { NAV.map.setPaintProperty('route-flow', 'line-dasharray', FLOW_STEPS[i]); } catch (e) {}
  }, 100);
}

function addAccuracyLayer() {
  NAV.map.addSource('accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  NAV.map.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#FF5A1F', 'fill-opacity': 0.1 } });
  NAV.map.addLayer({ id: 'accuracy-line', type: 'line', source: 'accuracy', paint: { 'line-color': '#FF5A1F', 'line-width': 1.5, 'line-opacity': 0.35 } });
}

function circlePolygon(lat, lng, radiusM) {
  const pts = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const dx = (radiusM * Math.cos(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
    const dy = (radiusM * Math.sin(angle)) / 110540;
    pts.push([lng + dx, lat + dy]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}
function updateAccuracyCircle(lat, lng, accuracy) {
  if (!NAV.map || !NAV.map.getSource('accuracy')) return;
  const r = Math.max(6, Math.min(accuracy, 120));
  NAV.map.getSource('accuracy').setData({ type: 'FeatureCollection', features: [circlePolygon(lat, lng, r)] });
}

function destinationMarkerEl() {
  const el = document.createElement('div');
  el.className = 'aliko-dest-pin';
  el.innerHTML = `<div class="pin-shadow"></div><svg width="34" height="42" viewBox="0 0 34 42"><path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 25 17 25s17-12.3 17-25C34 7.6 26.4 0 17 0z" fill="#FF5A1F"/><circle cx="17" cy="17" r="7" fill="#fff"/></svg>`;
  return el;
}
function addDestinationMarker(b) {
  if (NAV.destMarker) { try { NAV.destMarker.remove(); } catch (e) {} }
  NAV.destMarker = new maplibregl.Marker({ element: destinationMarkerEl(), anchor: 'bottom' }).setLngLat([Number(b.lng), Number(b.lat)]).addTo(NAV.map);
}

function puckEl() {
  const el = document.createElement('div');
  el.className = 'aliko-puck';
  el.innerHTML = `<div class="puck-beam"></div><div class="puck-dot"></div>`;
  return el;
}

function resetNav() {
  stopWatch();
  clearInterval(NAV.flowTimer);
  clearInterval(NAV.beaconTimer);
  cancelAnimationFrame(NAV.animRaf);
  NAV.route = null; NAV.coords = []; NAV.steps = []; NAV.stepIndex = 0; NAV.progressIndex = 0;
  NAV.altRoute = null; NAV.altCoords = null;
  NAV.lastRouteAt = 0; NAV.rerouting = false; NAV.userMovedMap = false; NAV.lastSpoken = ''; NAV.spokenThresholds = null;
  NAV.currentLat = null; NAV.currentLng = null; NAV.currentBearing = 0;
  NAV.animLat = null; NAV.animLng = null; NAV.firstFixAt = 0; NAV.finalApproachShown = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (NAV.puckMarker) { try { NAV.puckMarker.remove(); } catch (e) {} }
  if (NAV.destMarker) { try { NAV.destMarker.remove(); } catch (e) {} }
  if (NAV.map) { try { NAV.map.remove(); } catch (e) {} NAV.map = null; }
  NAV.puckMarker = null; NAV.destMarker = null; NAV.mapReady = false;
  const altChip = document.getElementById('navAltChip'); if (altChip) altChip.classList.add('hidden');
  const finalCard = document.getElementById('navFinalApproach'); if (finalCard) finalCard.classList.add('hidden');
}

function stopWatch() {
  if (NAV.watchId !== null) { try { navigator.geolocation.clearWatch(NAV.watchId); } catch (e) {} NAV.watchId = null; }
  clearTimeout(NAV.gpsWarnTimer); NAV.gpsWarnTimer = null;
}

function gpsWatchdog() {
  if (!NAV.active) return;
  if (Date.now() - NAV.lastGpsAt > 7000) showBanner('Still searching for a stronger GPS signal…');
  clearTimeout(NAV.gpsWarnTimer);
  NAV.gpsWarnTimer = setTimeout(gpsWatchdog, 5000);
}

async function onGpsUpdate(pos) {
  if (!NAV.active || !pos || !pos.coords) return;
  const lat = Number(pos.coords.latitude), lng = Number(pos.coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
  const heading = Number.isFinite(pos.coords.heading) && pos.coords.heading >= 0 ? pos.coords.heading : null;
  const speed = Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0 ? pos.coords.speed : null;

  NAV.lastGpsAt = Date.now();
  if (!NAV.firstFixAt) { NAV.firstFixAt = Date.now(); document.getElementById('navAcquiring').classList.add('hidden'); }
  updateGpsPill(accuracy);
  updateSpeed(speed);

  let bearing = NAV.currentBearing;
  if (heading !== null) bearing = heading;
  else if (NAV.currentLat !== null) {
    const b2 = bearingBetween(NAV.currentLat, NAV.currentLng, lat, lng);
    if (b2 !== null) bearing = b2;
  }

  const prevLat = NAV.currentLat, prevLng = NAV.currentLng;
  NAV.currentLat = lat; NAV.currentLng = lng; NAV.currentBearing = bearing;

  if (accuracy !== null) updateAccuracyCircle(lat, lng, accuracy);
  animatePuckTo(prevLat === null ? lat : prevLat, prevLng === null ? lng : prevLng, lat, lng, bearing);
  if (NAV.mapReady) followCamera(lat, lng, bearing, prevLat === null);

  if (!NAV.route && !NAV.rerouting) {
    showRoutePreview(lat, lng);
    await computeRoute(lat, lng, currentBusiness_forNav.lat, currentBusiness_forNav.lng, { alternatives: true });
    return;
  }
  if (!NAV.route) return;

  const distToDest = haversine(lat, lng, Number(currentBusiness_forNav.lat), Number(currentBusiness_forNav.lng));
  if (distToDest <= ARRIVAL_M) { vibrate([40, 60, 120]); handleArrival(); return; }
  updateFinalApproach(distToDest);

  // Skip the expensive recompute (closest-point search along the whole
  // route, stats, route-split redraw) when the new fix is basically the
  // same spot as last time — phones can fire GPS updates every ~1s even
  // when stationary, and redoing this work each time is wasted CPU that
  // shows up as jank/slowness rather than any real navigation benefit.
  const movedM = (prevLat !== null) ? haversine(prevLat, prevLng, lat, lng) : Infinity;
  if (movedM < 1.5 && NAV.route) return;

  const closest = closestOnRoute(lat, lng);
  if (closest.distance > OFF_ROUTE_M) {
    const now = Date.now();
    if (!NAV.rerouting && now - NAV.lastRouteAt >= REROUTE_COOLDOWN_MS) { await reroute(lat, lng); return; }
  } else {
    if (accuracy !== null && accuracy <= 50) hideBanner();
  }

  updateStep(lat, lng, closest);
  updateStats(closest);
  updateRouteSplit(closest);
  updateProgressBar();
}

// Feature: haptic cues on turns/arrival — a short vibration pattern gives a
// "felt" confirmation of a turn/arrival without having to glance at the
// screen or rely on the voice, which is easy to miss in a noisy street.
function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// Feature: last-mile indoor guidance. Once within ~60m of a destination
// that has floor/shop/entrance data, we swap the generic turn instruction
// for a card built from that data — something no general-purpose maps app
// can do, since it has no idea which floor or entrance to send you to.
function updateFinalApproach(distToDest) {
  const b = currentBusiness_forNav;
  const card = document.getElementById('navFinalApproach');
  if (!card || !b) return;
  const hasIndoorInfo = b.floor || b.shop || b.entrance || b.landmark;
  if (distToDest > FINAL_APPROACH_M || !hasIndoorInfo) { card.classList.add('hidden'); return; }
  if (!NAV.finalApproachShown) { NAV.finalApproachShown = true; vibrate([30, 40, 30]); }
  card.classList.remove('hidden');
  const rows = [
    b.building ? ['Building', b.building] : null,
    b.floor ? ['Floor', b.floor] : null,
    b.shop ? ['Shop / Unit', b.shop] : null,
    b.entrance ? ['Entrance', b.entrance] : null,
    b.landmark ? ['Landmark', b.landmark] : null,
  ].filter(Boolean);
  card.innerHTML = `<div class="fa-title">Almost there · ${Math.round(distToDest)}m</div>` +
    rows.map(([k, v]) => `<div class="fa-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function onGpsError(err) {
  let msg = 'GPS unavailable.';
  if (err.code === 1) msg = 'Location permission denied — allow access to navigate.';
  else if (err.code === 2) msg = 'Could not determine your location.';
  else if (err.code === 3) msg = 'GPS timed out — still trying…';
  showBanner(msg);
}

// Glides the puck (and its rotation, via the shortest angular path) between
// GPS fixes over ~550ms instead of snapping — this alone is most of what
// makes a tracked position feel "alive" rather than a jumping dot.
function animatePuckTo(fromLat, fromLng, toLat, toLng, toBearing) {
  if (!NAV.map) return;
  if (!NAV.puckMarker) {
    NAV.puckEl = puckEl();
    NAV.puckMarker = new maplibregl.Marker({ element: NAV.puckEl, anchor: 'center' }).setLngLat([toLng, toLat]).addTo(NAV.map);
    NAV.animLat = toLat; NAV.animLng = toLng; NAV.animBearing = toBearing;
    setPuckRotation(toBearing);
    return;
  }
  cancelAnimationFrame(NAV.animRaf);
  const startLat = NAV.animLat != null ? NAV.animLat : fromLat;
  const startLng = NAV.animLng != null ? NAV.animLng : fromLng;
  const startBearing = NAV.animBearing != null ? NAV.animBearing : toBearing;
  let deltaB = toBearing - startBearing;
  while (deltaB > 180) deltaB -= 360;
  while (deltaB < -180) deltaB += 360;
  const t0 = performance.now(), dur = 380;
  function step(now) {
    const t = Math.min(1, (now - t0) / dur);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const lat = startLat + (toLat - startLat) * ease;
    const lng = startLng + (toLng - startLng) * ease;
    const brg = startBearing + deltaB * ease;
    NAV.puckMarker.setLngLat([lng, lat]);
    setPuckRotation(brg);
    NAV.animLat = lat; NAV.animLng = lng; NAV.animBearing = brg;
    if (t < 1) NAV.animRaf = requestAnimationFrame(step);
  }
  NAV.animRaf = requestAnimationFrame(step);
}
function setPuckRotation(bearing) {
  if (!NAV.puckEl) return;
  const beam = NAV.puckEl.querySelector('.puck-beam');
  // In heading-up mode the map itself rotates to face travel direction, so
  // the puck's beam stays pointing straight up; in north-up mode the beam
  // shows the real compass bearing.
  const rot = NAV.headingUp ? 0 : bearing;
  if (beam) beam.style.transform = `rotate(${rot}deg)`;
}
function updateCompass(mapBearing) {
  const svg = document.getElementById('navCompassSvg');
  if (svg) svg.style.transform = `rotate(${-mapBearing}deg)`;
}

function followCamera(lat, lng, bearing, force) {
  if (!NAV.map || lat == null || (NAV.userMovedMap && !force)) return;
  try {
    const targetBearing = NAV.headingUp ? bearing : 0;
    NAV.map.easeTo({
      center: [lng, lat],
      zoom: force ? Math.max(NAV.map.getZoom(), 17) : NAV.map.getZoom(),
      pitch: NAV.pitchOn ? 58 : 0,
      bearing: targetBearing,
      duration: force ? 0 : 450,
      essential: true,
    });
    updateCompass(targetBearing);
    setPuckRotation(bearing);
  } catch (e) {}
}

async function computeRoute(fromLat, fromLng, toLat, toLng, opts) {
  opts = opts || {};
  NAV.rerouting = true;

  // Feature/fix: instant re-navigation via cache. If we've already routed
  // to this business from roughly here in the last few minutes, apply
  // that cached route immediately (no waiting at all) while a fresh one
  // is fetched underneath it — a real, felt speed-up on "I closed the app
  // and reopened it" or "let me check this route again" cases.
  const cacheKey = routeCacheKey(fromLat, fromLng, toLat, toLng, NAV.profile);
  const cached = readRouteCache(cacheKey);
  if (cached && !NAV.route) applyRoute(cached, opts);

  if (!cached) showBanner('Finding the best route…', true);
  try {
    const data = await fetchRoutes(fromLat, fromLng, toLat, toLng, NAV.profile, !!opts.alternatives);
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route found.');
    const route = data.routes[0];
    if (!route.geometry || !route.geometry.coordinates || route.geometry.coordinates.length < 2) throw new Error('Route had no usable geometry.');
    applyRoute(data, opts);
    writeRouteCache(cacheKey, data);
    hideBanner();
    return true;
  } catch (e) {
    if (!cached) {
      showBanner('Route problem: ' + e.message);
      setNavInstruction('depart', 0, 'Route unavailable', 'Waiting for GPS / routing…', '—');
    }
    return false;
  } finally {
    NAV.rerouting = false;
  }
}

function applyRoute(data, opts) {
  const route = data.routes[0];
  NAV.route = route;
  NAV.coords = route.geometry.coordinates;
  NAV.steps = extractSteps(route);
  NAV.stepIndex = 0; NAV.progressIndex = 0; NAV.lastRouteAt = Date.now(); NAV.spokenThresholds = new Set();

  NAV.altRoute = (opts.alternatives && data.routes[1] && data.routes[1].geometry) ? data.routes[1] : null;
  setRouteData(NAV.coords, 0);
  setAltRouteData(NAV.altRoute);
  renderAltChip();

  updateStats();
  updateProgressBar();
  if (NAV.currentLat !== null) {
    const c = closestOnRoute(NAV.currentLat, NAV.currentLng);
    updateStep(NAV.currentLat, NAV.currentLng, c);
    updateRouteSplit(c);
  }
  if (NAV.currentLat !== null) followCamera(NAV.currentLat, NAV.currentLng, NAV.currentBearing, true);
}

// Coarse-grained (roughly 100m) cache key so small GPS jitter still hits
// the cache. sessionStorage only (per-tab, cleared on close) — this is a
// speed convenience, not a source of truth, so it's fine if it goes stale.
function routeCacheKey(fromLat, fromLng, toLat, toLng, profile) {
  const round = (n) => Math.round(Number(n) * 1000) / 1000;
  return `aliko-route:${round(fromLat)},${round(fromLng)}:${toLat},${toLng}:${profile}`;
}
function readRouteCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > 3 * 60 * 1000) return null; // 3 min freshness window
    return parsed.data;
  } catch (e) { return null; }
}
function writeRouteCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
}

// Fetches a route for the given profile. Two layers of protection against
// a bad walking ETA:
// 1. If the request errors outright (backend has no "foot" profile at
//    all), fall back to the driving route and re-time it at walking pace.
// 2. Some public OSRM demo servers *accept* a "foot" request but silently
//    answer with driving data anyway (a known quirk — the profile in the
//    URL is ignored server-side and the car profile is returned regardless
//    of what was asked for), so a request can come back "successful" while
//    still being wrong. We check the implied speed (distance ÷ duration):
//    real walking speed tops out around 2 m/s, so anything faster is
//    obviously a car route wearing a walking label, and gets re-timed.
//    This is what actually fixes "someone driving cannot be the same as
//    someone walking" without needing to know which backend is in use.
const MAX_PLAUSIBLE_WALK_MPS = 2.2;
async function fetchRoutes(fromLat, fromLng, toLat, toLng, profile, alternatives) {
  const build = (p) => {
    const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng, profile: p });
    if (alternatives) params.set('alternatives', 'true');
    return `/api/directions?${params.toString()}`;
  };

  const reTimeForWalking = (data) => {
    data.routes.forEach((r) => {
      r.duration = (Number(r.distance) || 0) / WALK_SPEED_MPS;
      (r.legs || []).forEach((leg) => {
        (leg.steps || []).forEach((s) => { s.duration = (Number(s.distance) || 0) / WALK_SPEED_MPS; });
      });
      r._estimated = true;
    });
    return data;
  };

  // Fix: don't let a slow/hung routing backend stall navigation forever.
  // A hard client-side timeout plus one retry — most transient slowness
  // (cold-started server, one dropped packet) clears up on a second try
  // within a couple of seconds instead of leaving the user staring at
  // "Finding the best route…" indefinitely.
  const fetchWithTimeout = async (url, ms) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  };
  const fetchWithRetry = async (url) => {
    try { return await fetchWithTimeout(url, 6000); }
    catch (e) { return await fetchWithTimeout(url, 6000); }
  };

  let resp = await fetchWithRetry(build(profile));
  let data = await resp.json();
  if (resp.ok && data.code === 'Ok' && data.routes && data.routes.length) {
    if (profile === 'foot') {
      const main = data.routes[0];
      const impliedMps = (Number(main.duration) || 0) > 0 ? (Number(main.distance) || 0) / Number(main.duration) : 0;
      if (impliedMps > MAX_PLAUSIBLE_WALK_MPS) {
        showBanner('This map server only offers driving routes — walking time is estimated from the driving path.');
        return reTimeForWalking(data);
      }
    }
    return data;
  }

  if (profile === 'foot') {
    resp = await fetchWithRetry(build('driving'));
    data = await resp.json();
    if (resp.ok && data.code === 'Ok' && data.routes && data.routes.length) {
      showBanner('This map server only offers driving routes — walking time is estimated from the driving path.');
      return reTimeForWalking(data);
    }
  }
  throw new Error((data && data.error) || `Routing failed (${resp.status})`);
}

// Feature/fix: instant route preview. Real routing takes a network round
// trip; rather than staring at nothing while that happens, draw a straight
// dashed line toward the destination the instant we have a GPS fix, so
// there's an immediate sense of direction and progress. It's replaced the
// moment the real routed path comes back.
function showRoutePreview(lat, lng) {
  if (!NAV.map || !NAV.map.getSource('route-ahead') || !currentBusiness_forNav) return;
  const dest = [Number(currentBusiness_forNav.lng), Number(currentBusiness_forNav.lat)];
  setRouteData([[lng, lat], dest], 0);
}

function lineFeature(coords) {
  return { type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }] : [] };
}
// Splits the route into a dim "already travelled" line and a bright,
// gradient "ahead" line at the user's current progress index — the same
// visual language premium turn-by-turn apps use to show what's done vs
// what's left, instead of one flat-colored line end to end.
function setRouteData(coords, splitIndex) {
  if (!NAV.map || !NAV.map.getSource('route-ahead')) return;
  const idx = Math.max(0, Math.min(coords.length - 1, splitIndex));
  const behind = coords.slice(0, idx + 1);
  const ahead = coords.slice(idx);
  NAV.map.getSource('route-behind').setData(lineFeature(behind));
  NAV.map.getSource('route-ahead').setData(lineFeature(ahead.length > 1 ? ahead : coords));
}
function updateRouteSplit(closest) {
  if (!NAV.coords.length) return;
  const idx = closest && Number.isFinite(closest.index) ? closest.index : NAV.progressIndex;
  setRouteData(NAV.coords, idx);
}

// Feature: route alternatives. When the backend offers more than one
// route we draw the runner-up as a thin dashed line and surface a chip
// letting you switch to it if it's meaningfully faster — the same
// "pick your route" choice Google Maps gives you before you start, kept
// available throughout the trip instead of a one-time fork.
function setAltRouteData(alt) {
  if (!NAV.map || !NAV.map.getSource('route-alt-src')) return;
  NAV.map.getSource('route-alt-src').setData(alt && alt.geometry ? lineFeature(alt.geometry.coordinates) : { type: 'FeatureCollection', features: [] });
}
function renderAltChip() {
  const chip = document.getElementById('navAltChip');
  if (!chip) return;
  if (!NAV.altRoute || !NAV.route) { chip.classList.add('hidden'); return; }
  const deltaS = Math.round((NAV.route.duration - NAV.altRoute.duration) / 60);
  document.getElementById('navAltDelta').textContent = deltaS > 0 ? `${deltaS} min faster` : 'Alternative route';
  chip.classList.remove('hidden');
}
function switchAltRoute() {
  if (!NAV.altRoute) return;
  const prevMain = NAV.route;
  NAV.route = NAV.altRoute;
  NAV.altRoute = prevMain;
  NAV.coords = NAV.route.geometry.coordinates;
  NAV.steps = extractSteps(NAV.route);
  NAV.stepIndex = 0; NAV.progressIndex = 0; NAV.spokenThresholds = new Set();
  setRouteData(NAV.coords, 0);
  setAltRouteData(NAV.altRoute);
  renderAltChip();
  updateStats();
  updateProgressBar();
  if (NAV.currentLat !== null) {
    const c = closestOnRoute(NAV.currentLat, NAV.currentLng);
    updateStep(NAV.currentLat, NAV.currentLng, c);
    updateRouteSplit(c);
  }
}

async function reroute(lat, lng) {
  if (NAV.rerouting) return;
  const now = Date.now();
  if (now - NAV.lastRouteAt < REROUTE_COOLDOWN_MS) return;
  NAV.rerouting = true;
  showBanner('You left the route — recalculating…', true);
  NAV.route = null; NAV.steps = []; NAV.coords = []; NAV.stepIndex = 0; NAV.altRoute = null;
  try { await computeRoute(lat, lng, currentBusiness_forNav.lat, currentBusiness_forNav.lng); }
  finally { NAV.rerouting = false; }
}

function extractSteps(route) {
  const steps = [];
  if (!route || !Array.isArray(route.legs)) return steps;
  route.legs.forEach((leg) => {
    if (!Array.isArray(leg.steps)) return;
    leg.steps.forEach((step) => {
      const m = step.maneuver || {};
      const loc = Array.isArray(m.location) ? m.location : [];
      steps.push({
        distance: Number(step.distance) || 0, duration: Number(step.duration) || 0,
        name: step.name || '', type: m.type || 'continue', modifier: m.modifier || '', exit: m.exit,
        lat: Number(loc[1]) || 0, lng: Number(loc[0]) || 0,
      });
    });
  });
  return steps;
}

function updateStats(closest) {
  if (!NAV.route) return;
  const remaining = remainingDistance(closest);
  const duration = remainingDuration();
  document.getElementById('navRemaining').textContent = fmtM(remaining);
  const eta = new Date(Date.now() + duration * 1000);
  const etaText = eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  document.getElementById('navEta').textContent = NAV.route._estimated ? '~' + etaText : etaText;
}

// Feature: live journey progress bar — a slim fill bar in the bottom sheet
// showing how far through the trip you are, so there's a constant sense
// of progress instead of only a countdown number.
function updateProgressBar() {
  const fill = document.getElementById('navProgressFill');
  if (!fill || !NAV.route) return;
  const total = Number(NAV.route.distance) || 1;
  const remaining = remainingDistance();
  const pct = Math.max(2, Math.min(100, ((total - remaining) / total) * 100));
  fill.style.width = pct + '%';
}

function remainingDistance(closest) {
  if (!NAV.coords.length) return Number(NAV.route.distance) || 0;
  let idx = closest && Number.isFinite(closest.index) ? closest.index : NAV.progressIndex;
  idx = Math.max(0, Math.min(NAV.coords.length - 2, idx));
  let d = 0;
  if (closest && closest.point) { const end = NAV.coords[idx + 1]; d += haversine(closest.point[0], closest.point[1], end[1], end[0]); }
  for (let i = idx + 1; i < NAV.coords.length - 1; i++) d += haversine(NAV.coords[i][1], NAV.coords[i][0], NAV.coords[i + 1][1], NAV.coords[i + 1][0]);
  return d > 0 ? d : (Number(NAV.route.distance) || 0);
}

function remainingDuration() {
  if (!NAV.steps.length) return Number(NAV.route.duration) || 0;
  let d = 0;
  for (let i = NAV.stepIndex; i < NAV.steps.length; i++) d += NAV.steps[i].duration || 0;
  return d;
}

function updateStep(lat, lng, closest) {
  if (!NAV.steps.length) return;
  if (NAV.stepIndex >= NAV.steps.length) NAV.stepIndex = NAV.steps.length - 1;
  let step = NAV.steps[NAV.stepIndex];

  const distToCurrent = haversine(lat, lng, step.lat, step.lng);
  if (distToCurrent <= STEP_ADVANCE_M && NAV.stepIndex < NAV.steps.length - 1) {
    NAV.stepIndex++;
    step = NAV.steps[NAV.stepIndex];
    NAV.spokenThresholds = new Set();
    vibrate([35]);
  }

  const dist = haversine(lat, lng, step.lat, step.lng);
  setNavInstruction(maneuverKind(step), maneuverAngle(step), maneuverText(step), step.name || '', fmtM(dist));
  speak(step, dist);
}

function maneuverText(step) {
  const type = (step.type || '').toLowerCase(), mod = (step.modifier || '').toLowerCase();
  if (type === 'depart') return 'Start driving';
  if (type === 'arrive') return 'Arrive at destination';
  if (type === 'roundabout' || type === 'rotary') return step.exit ? 'Take exit ' + step.exit : 'Enter roundabout';
  if (type === 'uturn') return 'Make a U-turn';
  if (mod === 'sharp left') return 'Sharp left turn';
  if (mod === 'sharp right') return 'Sharp right turn';
  if (mod === 'left') return 'Turn left';
  if (mod === 'right') return 'Turn right';
  if (mod === 'slight left') return 'Bear left';
  if (mod === 'slight right') return 'Bear right';
  if (mod === 'straight') return 'Continue straight';
  return 'Continue';
}
// Kind picks which icon shape to draw; angle rotates the plain arrow shape
// for turns so we don't need a separate icon per direction.
function maneuverKind(step) {
  const type = (step.type || '').toLowerCase();
  if (type === 'arrive') return 'arrive';
  if (type === 'depart') return 'depart';
  if (type === 'roundabout' || type === 'rotary') return 'roundabout';
  if (type === 'uturn') return 'uturn';
  return 'arrow';
}
function maneuverAngle(step) {
  const mod = (step.modifier || '').toLowerCase();
  const angles = { 'sharp right': 135, right: 90, 'slight right': 35, straight: 0, 'slight left': -35, left: -90, 'sharp left': -135 };
  return angles[mod] != null ? angles[mod] : 0;
}
function maneuverSVG(kind, angle) {
  if (kind === 'arrive') return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M6 3v18M6 4h11l-2.5 3L17 10H6" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  if (kind === 'roundabout') return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="#fff" stroke-width="2"/><path d="M12 2v6M12 2l-3 3M12 2l3 3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (kind === 'uturn') return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M9 4v7a5 5 0 0 0 10 0V9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M5 8l4-4 4 4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="transform:rotate(${angle}deg);transition:transform .25s ease;"><path d="M12 21V5M12 5l-6 6M12 5l6 6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Feature: multi-distance voice cues. Instead of one announcement right
// before a turn, cues fire at 500m/200m/50m thresholds (each spoken once
// per step) — enough warning on foot or on a bike, not just in a car.
const SPEAK_THRESHOLDS = [500, 200, 50];
function speak(step, dist) {
  if (!NAV.speech || !window.speechSynthesis) return;
  const threshold = SPEAK_THRESHOLDS.find((t) => dist <= t && !NAV.spokenThresholds.has(t));
  if (threshold == null) return;
  NAV.spokenThresholds.add(threshold);
  const msg = maneuverText(step) + (step.name ? ' onto ' + step.name : '') + ' in ' + (Math.max(10, Math.round(dist / 10) * 10)) + ' metres.';
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(msg);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

function closestOnRoute(lat, lng) {
  if (NAV.coords.length < 2) return { distance: Infinity, point: null, index: -1 };
  let best = Infinity, point = null, index = -1;
  const start = Math.max(0, NAV.progressIndex - 60), end = Math.min(NAV.coords.length - 2, NAV.progressIndex + 200);
  for (let i = start; i <= end; i++) {
    const a = NAV.coords[i], b = NAV.coords[i + 1];
    const r = closestOnSegment(lat, lng, a[1], a[0], b[1], b[0]);
    if (r.distance < best) { best = r.distance; point = r.point; index = i; }
  }
  if (index === -1 || best > 400) {
    for (let i = 0; i < NAV.coords.length - 1; i++) {
      const a = NAV.coords[i], b = NAV.coords[i + 1];
      const r = closestOnSegment(lat, lng, a[1], a[0], b[1], b[0]);
      if (r.distance < best) { best = r.distance; point = r.point; index = i; }
    }
  }
  if (index >= 0) NAV.progressIndex = Math.max(NAV.progressIndex, index);
  return { distance: best, point, index };
}
function closestOnSegment(lat, lng, lat1, lng1, lat2, lng2) {
  const dx = lng2 - lng1, dy = lat2 - lat1;
  let t = 0;
  const denom = dx * dx + dy * dy;
  if (denom > 0) t = Math.max(0, Math.min(1, ((lng - lng1) * dx + (lat - lat1) * dy) / denom));
  const px = lng1 + t * dx, py = lat1 + t * dy;
  return { distance: haversine(lat, lng, py, px), point: [py, px] };
}

function updateGpsPill(accuracy) {
  const dot = document.getElementById('navGpsDot'), text = document.getElementById('navGpsText'), accEl = document.getElementById('navAccuracy');
  if (accuracy === null) { dot.className = 'nav-gps-dot bad'; text.textContent = 'NO GPS'; return; }
  if (accuracy <= 15) { dot.className = 'nav-gps-dot'; text.textContent = 'GPS'; }
  else if (accuracy <= 40) { dot.className = 'nav-gps-dot warn'; text.textContent = 'WEAK'; }
  else { dot.className = 'nav-gps-dot bad'; text.textContent = 'POOR'; }
  if (accEl) accEl.textContent = Math.round(accuracy) + 'm';
}
function updateSpeed(speed) {
  const el = document.getElementById('navSpeed');
  if (!el) return;
  el.textContent = speed == null ? '—' : Math.round(speed * 3.6) + ' km/h';
}

function setNavInstruction(kind, angle, main, road, dist) {
  document.getElementById('navIcon').innerHTML = maneuverSVG(kind, angle);
  document.getElementById('navMain').textContent = main || 'Continue';
  document.getElementById('navRoad').textContent = road || '';
  document.getElementById('navDist').textContent = dist || '—';
}
function showBanner(msg, rerouting) {
  const el = document.getElementById('navBanner');
  el.textContent = (rerouting ? '↻ ' : '⚠ ') + msg;
  el.classList.toggle('rerouting', !!rerouting);
  el.style.display = 'block';
}
function hideBanner() { document.getElementById('navBanner').style.display = 'none'; }

function handleArrival() {
  if (!NAV.active) return;
  NAV.active = false;
  stopWatch();
  api('/businesses/' + currentBusiness_forNav.id + '/arrival', { method: 'POST', body: { found: true } }).catch(() => {});
  showArrivalCard(currentBusiness_forNav, true);
}

function showArrivalCard(b, arrived) {
  let card = document.getElementById('arrivalCard');
  if (!card) { card = document.createElement('div'); card.id = 'arrivalCard'; document.body.appendChild(card); }
  // Fix: this used to be a full-screen dark/blurred overlay that completely
  // hid the live map right when arriving — the moment someone most needs
  // to see their position relative to the destination (exact shop/floor).
  // It's now a bottom sheet: the map stays visible above it, closer to how
  // Uber/Google Maps present an arrival state.
  card.className = 'nav-arrival-sheet-overlay';
  card.innerHTML = `
    <div class="nav-arrival-sheet">
      <div class="arrival-check">${arrived ? '✓' : '📍'}</div>
      <div class="arrival-title">${arrived ? 'You have arrived' : 'Exact destination'}</div>
      <div class="arrival-sub">${escapeHtml(b.name)}</div>
      <div class="arrival-grid">
        <div><div class="addr-label">Building</div><div class="addr-val small">${escapeHtml(b.building || 'Not provided')}</div></div>
        <div><div class="addr-label">Entrance</div><div class="addr-val small">${escapeHtml(b.entrance || 'Not provided')}</div></div>
        <div><div class="addr-label">Floor</div><div class="addr-val small">${escapeHtml(b.floor || 'Not provided')}</div></div>
        <div><div class="addr-label">Shop</div><div class="addr-val small">${escapeHtml(b.shop || 'Not provided')}</div></div>
      </div>
      ${arrived ? `<div class="arrival-rate-row"><span>How was getting here?</span><div class="aliko-star-input" id="arrivalStars">${[5,4,3,2,1].map((n)=>`<span data-val="${n}">★</span>`).join('')}</div></div>` : ''}
      <button class="btn primary block" id="arrivalCloseBtn">${arrived ? 'Done' : 'Continue navigation'}</button>
    </div>`;
  document.getElementById('arrivalCloseBtn').onclick = () => { card.className = 'hidden'; if (arrived) exitNavigation(); };
  // Feature: post-arrival rating prompt (Uber-style "rate your trip"),
  // pre-fills the star value and jumps straight to the review form.
  const starsWrap = document.getElementById('arrivalStars');
  if (starsWrap) {
    starsWrap.querySelectorAll('span').forEach((s) => s.addEventListener('click', () => {
      card.className = 'hidden';
      exitNavigation();
      const ratingSelect = document.getElementById('rv-rating');
      const reviewForm = document.getElementById('reviewForm');
      if (ratingSelect && reviewForm) {
        ratingSelect.value = s.dataset.val;
        const starInput = reviewForm.querySelector('.aliko-star-input');
        if (starInput) starInput.querySelectorAll('span').forEach((st) => st.classList.toggle('filled', Number(st.dataset.val) <= Number(s.dataset.val)));
        reviewForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const textEl = document.getElementById('rv-text');
        if (textEl) textEl.focus();
      }
    }));
  }
}

function exitNavigation() {
  NAV.active = false;
  stopWatch();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  document.getElementById('navPanel').classList.add('hidden');
  document.body.classList.remove('nav-open');
  const card = document.getElementById('arrivalCard');
  if (card) card.className = 'hidden';
  resetNav();
}

document.getElementById('navExitBtn').addEventListener('click', exitNavigation);
document.getElementById('navStopBtn').addEventListener('click', exitNavigation);
document.getElementById('navMuteBtn').addEventListener('click', (e) => {
  NAV.speech = !NAV.speech;
  e.target.textContent = NAV.speech ? '🔊 Voice ON' : '🔇 Voice';
  if (!NAV.speech && window.speechSynthesis) window.speechSynthesis.cancel();
});
document.getElementById('navDetailsBtn').addEventListener('click', () => { if (currentBusiness_forNav) showArrivalCard(currentBusiness_forNav, false); });
document.getElementById('navProfileWalk').addEventListener('click', () => setProfile('foot'));
document.getElementById('navProfileDrive').addEventListener('click', () => setProfile('driving'));
document.getElementById('navAltSwitchBtn').addEventListener('click', switchAltRoute);
document.getElementById('navShareBtn').addEventListener('click', shareTrip);
// Feature: share trip / live ETA. One tap to send a formatted ETA message
// via the device's native share sheet (WhatsApp, SMS, etc.) or fall back
// to copying it — handy for "I'm on my way, here's when I'll arrive".
function shareTrip() {
  const b = currentBusiness_forNav;
  if (!b) return;
  const etaEl = document.getElementById('navEta');
  const remEl = document.getElementById('navRemaining');
  const text = `Heading to ${b.name} — ETA ${etaEl ? etaEl.textContent : '—'} (${remEl ? remEl.textContent : '—'} left).`;
  if (navigator.share) {
    navigator.share({ title: 'My trip', text }).catch(() => {});
  } else {
    const url = 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
  }
}

document.getElementById('navRecenterBtn').addEventListener('click', () => {
  NAV.userMovedMap = false;
  if (NAV.currentLat !== null) followCamera(NAV.currentLat, NAV.currentLng, NAV.currentBearing, true);
});
document.getElementById('navCompassBtn').addEventListener('click', () => {
  NAV.headingUp = !NAV.headingUp;
  NAV.userMovedMap = false;
  if (NAV.currentLat !== null) followCamera(NAV.currentLat, NAV.currentLng, NAV.currentBearing, true);
});
document.getElementById('navTiltBtn').addEventListener('click', (e) => {
  NAV.pitchOn = !NAV.pitchOn;
  e.target.textContent = NAV.pitchOn ? '3D' : '2D';
  if (NAV.map) { try { NAV.map.easeTo({ pitch: NAV.pitchOn ? 58 : 0, duration: 400 }); } catch (err) {} }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && NAV.active) exitNavigation(); });
window.addEventListener('beforeunload', () => { stopWatch(); if (window.speechSynthesis) window.speechSynthesis.cancel(); });

/* ============================= MATH HELPERS ============================= */

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearingBetween(lat1, lng1, lat2, lng2) {
  if (haversine(lat1, lng1, lat2, lng2) < 2) return null;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function fmtM(m) {
  if (m == null || !Number.isFinite(Number(m))) return '—';
  m = Number(m);
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
}

load();
