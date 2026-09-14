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

/* =====================================================================
   NAVIGATION — full-screen turn-by-turn, powered by /api/directions
   (which itself talks to your configured OSRM_URL server-side)
   ===================================================================== */

const NAV = {
  map: null, mapReady: false,
  puckEl: null, puckMarker: null, destMarker: null,
  watchId: null, active: false,
  route: null, coords: [], steps: [], stepIndex: 0, progressIndex: 0,
  lastRouteAt: 0, rerouting: false, userMovedMap: false,
  speech: false, lastSpoken: '',
  gpsWarnTimer: null, lastGpsAt: 0, firstFixAt: 0, flowTimer: null,
  currentLat: null, currentLng: null, currentBearing: 0,
  animLat: null, animLng: null, animBearing: 0, animRaf: null,
  headingUp: true, pitchOn: true,
};

const ARRIVAL_M = 30;
const OFF_ROUTE_M = 45;
const STEP_ADVANCE_M = 28;
const REROUTE_COOLDOWN_MS = 8000;
// Free vector basemap (OpenFreeMap, no API key) that includes real building
// footprints/heights, so navigation renders extruded 3D buildings instead
// of the old flat, blocky raster tiles.
const NAV_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function startNavigation(b) {
  if (!navigator.geolocation) { toast('Geolocation is not available in this browser.'); return; }
  currentBusiness_forNav = b;
  resetNav();
  NAV.active = true;
  document.getElementById('navPanel').classList.remove('hidden');
  document.body.classList.add('nav-open');
  document.getElementById('navAcquiring').classList.remove('hidden');
  setNavInstruction('depart', 0, 'Finding your position…', '', '—');
  document.getElementById('navDestName').textContent = b.name;
  document.getElementById('navDestAddr').textContent = [b.building, b.floor ? 'Floor ' + b.floor : '', b.shop ? 'Shop ' + b.shop : ''].filter(Boolean).join(' · ');

  setTimeout(() => initNavMap(b), 50);

  api('/businesses/' + b.id + '/track', { method: 'POST', body: { type: 'navigation' } }).catch(() => {});

  // A quick low-accuracy fix (usually cell/wifi, near-instant) so the map
  // and puck appear right away, instead of a blank screen while the phone
  // waits for a full GPS lock. watchPosition below then refines it.
  navigator.geolocation.getCurrentPosition(onGpsUpdate, () => {}, { enableHighAccuracy: false, maximumAge: 45000, timeout: 5000 });

  NAV.lastGpsAt = Date.now();
  NAV.watchId = navigator.geolocation.watchPosition(onGpsUpdate, onGpsError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  clearTimeout(NAV.gpsWarnTimer);
  NAV.gpsWarnTimer = setTimeout(gpsWatchdog, 7000);
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
    add3DBuildings();
    addSky();
    addRouteLayers();
    addAccuracyLayer();
    addDestinationMarker(b);
    NAV.map.resize();
    if (NAV.currentLat !== null) animatePuckTo(NAV.currentLat, NAV.currentLng, NAV.currentLat, NAV.currentLng, NAV.currentBearing);
  });
}

function add3DBuildings() {
  try {
    const layers = NAV.map.getStyle().layers || [];
    const labelLayer = layers.find((l) => l.type === 'symbol');
    NAV.map.addLayer({
      id: 'aliko-3d-buildings', source: 'openmaptiles', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 13,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, '#242833', 40, '#343B4A', 120, '#454E62'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.9,
      },
    }, labelLayer ? labelLayer.id : undefined);
  } catch (e) {}
}

function addSky() {
  try {
    NAV.map.setLight({ anchor: 'viewport', intensity: 0.3 });
    NAV.map.addLayer({ id: 'aliko-sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 8 } });
  } catch (e) {}
}

function addRouteLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  NAV.map.addSource('route-behind', { type: 'geojson', data: empty });
  NAV.map.addSource('route-ahead', { type: 'geojson', data: empty, lineMetrics: true });

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
  cancelAnimationFrame(NAV.animRaf);
  NAV.route = null; NAV.coords = []; NAV.steps = []; NAV.stepIndex = 0; NAV.progressIndex = 0;
  NAV.lastRouteAt = 0; NAV.rerouting = false; NAV.userMovedMap = false; NAV.lastSpoken = '';
  NAV.currentLat = null; NAV.currentLng = null; NAV.currentBearing = 0;
  NAV.animLat = null; NAV.animLng = null; NAV.firstFixAt = 0;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (NAV.puckMarker) { try { NAV.puckMarker.remove(); } catch (e) {} }
  if (NAV.destMarker) { try { NAV.destMarker.remove(); } catch (e) {} }
  if (NAV.map) { try { NAV.map.remove(); } catch (e) {} NAV.map = null; }
  NAV.puckMarker = null; NAV.destMarker = null; NAV.mapReady = false;
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

  if (!NAV.route && !NAV.rerouting) { await computeRoute(lat, lng, currentBusiness_forNav.lat, currentBusiness_forNav.lng); return; }
  if (!NAV.route) return;

  const distToDest = haversine(lat, lng, Number(currentBusiness_forNav.lat), Number(currentBusiness_forNav.lng));
  if (distToDest <= ARRIVAL_M) { handleArrival(); return; }

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
  const t0 = performance.now(), dur = 550;
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
      duration: force ? 0 : 700,
      essential: true,
    });
    updateCompass(targetBearing);
    setPuckRotation(bearing);
  } catch (e) {}
}

async function computeRoute(fromLat, fromLng, toLat, toLng) {
  NAV.rerouting = true;
  showBanner('Finding the best route…', true);
  try {
    const url = `/api/directions?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`;
    const resp = await fetch(url, { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `Routing failed (${resp.status})`);
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route found.');
    const route = data.routes[0];
    if (!route.geometry || !route.geometry.coordinates || route.geometry.coordinates.length < 2) throw new Error('Route had no usable geometry.');

    NAV.route = route;
    NAV.coords = route.geometry.coordinates;
    NAV.steps = extractSteps(route);
    NAV.stepIndex = 0; NAV.progressIndex = 0; NAV.lastRouteAt = Date.now();

    setRouteData(NAV.coords, 0);
    updateStats();
    if (NAV.currentLat !== null) {
      const c = closestOnRoute(NAV.currentLat, NAV.currentLng);
      updateStep(NAV.currentLat, NAV.currentLng, c);
      updateRouteSplit(c);
    }
    hideBanner();
    if (NAV.currentLat !== null) followCamera(NAV.currentLat, NAV.currentLng, NAV.currentBearing, true);
    return true;
  } catch (e) {
    showBanner('Route problem: ' + e.message);
    setNavInstruction('depart', 0, 'Route unavailable', 'Waiting for GPS / routing…', '—');
    return false;
  } finally {
    NAV.rerouting = false;
  }
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

async function reroute(lat, lng) {
  if (NAV.rerouting) return;
  const now = Date.now();
  if (now - NAV.lastRouteAt < REROUTE_COOLDOWN_MS) return;
  NAV.rerouting = true;
  showBanner('You left the route — recalculating…', true);
  NAV.route = null; NAV.steps = []; NAV.coords = []; NAV.stepIndex = 0;
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
  document.getElementById('navEta').textContent = eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function speak(step, dist) {
  if (!NAV.speech || !window.speechSynthesis || dist > 220) return;
  const msg = maneuverText(step) + (step.name ? ' onto ' + step.name : '') + ' in ' + (Math.max(10, Math.round(dist / 10) * 10)) + ' metres.';
  if (msg === NAV.lastSpoken) return;
  NAV.lastSpoken = msg;
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
  card.className = 'arrival-overlay';
  card.innerHTML = `
    <div class="arrival-card">
      <div class="arrival-check">${arrived ? '✓' : '📍'}</div>
      <div class="arrival-title">${arrived ? 'You have arrived' : 'Exact destination'}</div>
      <div class="arrival-sub">${escapeHtml(b.name)}</div>
      <div class="arrival-grid">
        <div><div class="addr-label">Building</div><div class="addr-val small">${escapeHtml(b.building || 'Not provided')}</div></div>
        <div><div class="addr-label">Entrance</div><div class="addr-val small">${escapeHtml(b.entrance || 'Not provided')}</div></div>
        <div><div class="addr-label">Floor</div><div class="addr-val small">${escapeHtml(b.floor || 'Not provided')}</div></div>
        <div><div class="addr-label">Shop</div><div class="addr-val small">${escapeHtml(b.shop || 'Not provided')}</div></div>
      </div>
      <button class="btn primary block" id="arrivalCloseBtn">${arrived ? 'Done' : 'Continue navigation'}</button>
    </div>`;
  document.getElementById('arrivalCloseBtn').onclick = () => { card.className = 'hidden'; if (arrived) exitNavigation(); };
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
