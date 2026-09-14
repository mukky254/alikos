// public/js/home.js
const state = { query: '', category: null, lat: null, lng: null, sort: '', openNow: false, mapView: false };
let debounceTimer;
let resultsMap = null;
let resultsMarkers = [];

renderNav('home');
loadTrending();
loadCategories();
loadResults();

async function loadTrending() {
  try {
    const { businesses } = await api('/businesses/trending');
    const top = (businesses || []).filter((b) => (b.recentViews || 0) > 0).slice(0, 4);
    if (!top.length) return;
    document.getElementById('trendingWrap').innerHTML = `
      <div class="card">
        <h3>🔥 Trending this week</h3>
        <div class="chip-row" style="margin-bottom:0;">
          ${top.map((b) => `<a href="business.html?id=${b.id}" class="chip">${escapeHtml(b.name)} · ${b.recentViews} views</a>`).join('')}
        </div>
      </div>`;
  } catch (e) {}
}

async function loadCategories() {
  try {
    const { categories } = await api('/businesses/categories');
    renderChips(categories || []);
  } catch (e) { renderChips([]); }
}

function renderChips(categories) {
  const wrap = document.getElementById('categoryChips');
  const all = `<button class="chip ${state.category === null ? 'active' : ''}" data-cat="">All categories</button>`;
  const rest = categories.map((c) => `<button class="chip ${state.category === c.category ? 'active' : ''}" data-cat="${escapeHtml(c.category)}">${escapeHtml(c.category)} (${c.count})</button>`).join('');
  wrap.innerHTML = all + rest;
  wrap.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => { state.category = chip.dataset.cat || null; renderChips(categories); loadResults(); });
  });
}

function tierBadge(b) {
  if (!b.verified) return '<span class="badge pending">PENDING</span>';
  if (b.verification_tier === 'premium') return '<span class="badge premium">PREMIUM</span>';
  return '<span class="badge verified">VERIFIED</span>';
}

function rowHTML(b) {
  const openBadge = b.openNow === true ? '<span class="badge open">OPEN</span>' : b.openNow === false ? '<span class="badge closed">CLOSED</span>' : '';
  const dist = b.distanceKm != null ? `<div class="row-dist">${fmtDist(b.distanceKm)}</div>` : '';
  const rating = b.avgRating ? `<span class="stars">★</span> ${b.avgRating} (${b.reviewCount})` : '';
  return `<a class="row" href="business.html?id=${b.id}">
    <div class="plate">${escapeHtml(b.floor || '·')}<br>${escapeHtml(b.shop || '')}</div>
    <div class="row-main">
      <div class="row-name">${escapeHtml(b.name)} ${tierBadge(b)} ${openBadge}</div>
      <div class="row-meta">${escapeHtml(b.category)} ${rating ? '· ' + rating : ''}</div>
      <div class="row-loc">${escapeHtml(b.building)} ${b.landmark ? '· ' + escapeHtml(b.landmark) : ''}</div>
    </div>
    ${dist}
  </a>`;
}

async function loadResults() {
  const wrap = document.getElementById('results');
  try {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.category) params.set('category', state.category);
    if (state.lat != null) { params.set('lat', state.lat); params.set('lng', state.lng); }
    if (state.sort) params.set('sort', state.sort);
    if (state.openNow) params.set('openNow', '1');
    const { businesses } = await api('/businesses?' + params.toString());
    document.getElementById('resultCount').textContent =
      businesses.length + (businesses.length === 1 ? ' business found' : ' businesses found') + (state.lat != null ? ' · sorted by distance' : '');
    if (!businesses.length) { wrap.innerHTML = '<div class="empty">No matches yet. Try a different name, category, or building.</div>'; }
    else { wrap.innerHTML = businesses.map(rowHTML).join(''); }
    if (state.mapView) renderMap(businesses);
  } catch (e) {
    wrap.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

function renderMap(businesses) {
  if (typeof L === 'undefined') return;
  if (!resultsMap) resultsMap = L.map('resultsMap');
  resultsMarkers.forEach((m) => resultsMap.removeLayer(m));
  resultsMarkers = [];
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(resultsMap);
  const withCoords = businesses.filter((b) => b.lat && b.lng);
  if (!withCoords.length) { resultsMap.setView([-1.2841, 36.8233], 14); return; }
  withCoords.forEach((b) => {
    const marker = L.marker([b.lat, b.lng]).addTo(resultsMap).bindPopup(`<strong>${escapeHtml(b.name)}</strong><br>${escapeHtml(b.building)}<br><a href="business.html?id=${b.id}">View profile →</a>`);
    resultsMarkers.push(marker);
  });
  const group = L.featureGroup(resultsMarkers);
  resultsMap.fitBounds(group.getBounds().pad(0.2));
}

document.getElementById('viewToggleBtn').addEventListener('click', () => {
  state.mapView = !state.mapView;
  document.getElementById('mapWrap').classList.toggle('open', state.mapView);
  document.getElementById('viewToggleBtn').textContent = state.mapView ? '📋 List view' : '🗺 Map view';
  if (state.mapView) setTimeout(() => loadResults(), 50);
});

document.getElementById('sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; loadResults(); });
document.getElementById('openNowCheck').addEventListener('change', (e) => { state.openNow = e.target.checked; loadResults(); });

document.getElementById('searchInput').addEventListener('input', (e) => {
  state.query = e.target.value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { loadResults(); loadSuggestions(e.target.value); }, 250);
});
document.getElementById('searchInput').addEventListener('blur', () => setTimeout(() => { document.getElementById('suggestBox').style.display = 'none'; }, 150));

async function loadSuggestions(q) {
  const box = document.getElementById('suggestBox');
  if (!q || q.length < 2) { box.style.display = 'none'; return; }
  try {
    const { suggestions } = await api('/businesses/autocomplete?q=' + encodeURIComponent(q));
    if (!suggestions.length) { box.style.display = 'none'; return; }
    box.innerHTML = suggestions.map((s) => `<div class="suggest-item" data-id="${s.id}"><strong>${escapeHtml(s.name)}</strong><div class="faint" style="font-size:11px;">${escapeHtml(s.category)} · ${escapeHtml(s.building || '')}</div></div>`).join('');
    box.style.display = 'block';
    box.querySelectorAll('.suggest-item').forEach((row) => row.addEventListener('mousedown', () => { window.location.href = 'business.html?id=' + row.dataset.id; }));
  } catch (e) { box.style.display = 'none'; }
}

document.getElementById('nearMeBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Geolocation is not available in this browser.'); return; }
  toast('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => { state.lat = pos.coords.latitude; state.lng = pos.coords.longitude; toast('Location found — sorted by distance.'); loadResults(); },
    (err) => toast('Could not get your location (' + err.message + ').'),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});
