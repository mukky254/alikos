// public/js/nav3d.js
// Aliko Navigation V3 — MapLibre GL powered turn-by-turn navigation.
//
// Still uses your own OSRM server through /api/directions (no Google Maps API,
// no API key). What changed from V2 is the map/UX layer:
//   - MapLibre GL (vector tiles, free OpenFreeMap styles) instead of flat Leaflet
//     raster tiles, so we get a real perspective/3D camera and extruded buildings.
//   - A route-preview step (like Google Maps / Uber) before you start driving.
//   - Route alternatives you can tap to switch between.
//   - A "next maneuver" look-ahead line.
//   - Live speed, unit switching, day/night + map style toggles, north-up vs
//     heading-up camera, an optional "add a stop" waypoint, resumable sessions,
//     a trip summary on arrival, and a lightweight ETA-share action.
//
// See NAVIGATION-V3-NOTES.md for the full list and honest limitations
// (there is no live traffic and no posted-speed-limit data — OSRM/OSM don't
// reliably give us either for free).

const MAP_STYLES = [
  { id: 'liberty', label: 'Streets', url: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'bright', label: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'positron', label: 'Minimal', url: 'https://tiles.openfreemap.org/styles/positron' },
];

const ARRIVAL_M = 30;
const OFF_ROUTE_M = 45;
const STEP_ADVANCE_M = 28;
const REROUTE_COOLDOWN_MS = 8000;
const VOICE_THRESHOLDS_M = [400, 150, 30];
const RESUME_KEY = 'aliko_active_nav';
const MI = 1609.344, FT = 0.3048;

const NAV = {
  map: null, marker: null, altMarker: null, userMarker: null,
  active: false, previewing: false,
  mode: 'driving',
  route: null, coords: [], steps: [], stepIndex: 0, progressIndex: 0,
  altRoutes: [], altIndex: 0,
  waypoint: null, addingStop: false,
  watchId: null,
  lastRouteAt: 0, rerouting: false, userMovedMap: false,
  speech: false, lastSpokenKey: '',
  gpsWarnTimer: null, lastGpsAt: 0,
  currentLat: null, currentLng: null, currentBearing: null,
  headingUp: true, styleIndex: 0, night: null, units: 'metric',
  speedKmh: 0, lastSpeedFix: null,
  tripStartAt: 0, tripStartDistanceM: 0,
  announced: new Set(),
};

/* ============================= PREFERENCES ============================= */

function loadPrefs() {
  try {
    NAV.units = localStorage.getItem('aliko_nav_units') || (Intl.DateTimeFormat().resolvedOptions().locale === 'en-US' ? 'imperial' : 'metric');
    NAV.headingUp = localStorage.getItem('aliko_nav_headingup') !== 'off';
    const styleId = localStorage.getItem('aliko_nav_style');
    const idx = MAP_STYLES.findIndex((s) => s.id === styleId);
    NAV.styleIndex = idx >= 0 ? idx : 0;
    const theme = localStorage.getItem('aliko_nav_theme');
    NAV.night = theme === 'night' ? true : theme === 'day' ? false : null; // null = auto by time of day
  } catch (e) {}
}

function isNightNow() {
  if (NAV.night !== null) return NAV.night;
  const h = new Date().getHours();
  return h < 6 || h >= 19;
}

/* ============================= ENTRY POINT ============================= */

function startNavigation(b) {
  if (!navigator.geolocation) { toast('Geolocation is not available in this browser.'); return; }
  loadPrefs();
  currentBusiness_forNav = b;
  resetNav();
  NAV.previewing = true;
  document.getElementById('navPanel').classList.remove('hidden');
  document.body.classList.add('nav-open');
  document.getElementById('navTopbar').classList.add('hidden');
  document.getElementById('navPreview').classList.remove('hidden');
  document.getElementById('navPreviewName').textContent = b.name;
  document.getElementById('navPreviewAddr').textContent = destLine(b);
  document.getElementById('navDestName').textContent = b.name;
  document.getElementById('navDestAddr').textContent = destLine(b);
  document.getElementById('navAltList').innerHTML = '<div class="loading">Finding your location…</div>';
  document.getElementById('navGoBtn').disabled = true;
  setUnitsButtonLabel();

  buildMap(b);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      NAV.currentLat = Number(pos.coords.latitude);
      NAV.currentLng = Number(pos.coords.longitude);
      fitPreview(b);
      computePreviewRoutes(b);
    },
    () => {
      document.getElementById('navAltList').innerHTML = '<div class="error-box">Could not get your location. Check location permission and try again.<br><button class="btn small" id="navRetryLocBtn" style="margin-top:8px;">Retry</button></div>';
      const retry = document.getElementById('navRetryLocBtn');
      if (retry) retry.addEventListener('click', () => startNavigation(b));
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

function destLine(b) {
  return [b.building, b.floor ? 'Floor ' + b.floor : '', b.shop ? 'Shop ' + b.shop : ''].filter(Boolean).join(' · ');
}

/* ============================= MAP SETUP ============================= */

function buildMap(b) {
  setTimeout(() => {
    if (typeof maplibregl === 'undefined') { toast('Map engine failed to load — check your connection.'); return; }
    NAV.map = new maplibregl.Map({
      container: 'navMap',
      style: MAP_STYLES[NAV.styleIndex].url,
      center: [Number(b.lng), Number(b.lat)],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
    });
    NAV.map.on('load', () => { add3DBuildings(); addRouteLayers(); applyNightFilter(); });
    NAV.map.on('dragstart', () => { NAV.userMovedMap = true; });
    NAV.map.on('click', (e) => { if (NAV.addingStop) placeStop(e.lngLat.lat, e.lngLat.lng); });

    const el = document.createElement('div');
    el.className = 'aliko-dest-pin';
    NAV.marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([Number(b.lng), Number(b.lat)]).addTo(NAV.map);
  }, 50);
}

function add3DBuildings() {
  try {
    const style = NAV.map.getStyle();
    if (!style || !style.sources || !style.sources.openmaptiles || NAV.map.getLayer('aliko-3d-buildings')) return;
    let labelLayerId;
    for (const l of style.layers) { if (l.type === 'symbol' && l.layout && l.layout['text-field']) { labelLayerId = l.id; break; } }
    NAV.map.addLayer({
      id: 'aliko-3d-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-color': '#3a4150',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.8,
      },
    }, labelLayerId);
  } catch (e) { /* style doesn't expose building layer this way — skip 3D buildings gracefully */ }
}

function addRouteLayers() {
  const map = NAV.map;
  if (!map || map.getSource('route-alts')) return;
  map.addSource('route-alts', { type: 'geojson', data: emptyFC() });
  map.addLayer({ id: 'route-alts-line', type: 'line', source: 'route-alts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8b93a3', 'line-width': 6, 'line-opacity': 0.85 } });
  map.addSource('route-done', { type: 'geojson', data: emptyFC() });
  map.addLayer({ id: 'route-done-line', type: 'line', source: 'route-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7a8090', 'line-width': 6, 'line-opacity': 0.6 } });
  map.addSource('route', { type: 'geojson', data: emptyFC() });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 13, 'line-opacity': 0.35 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF5A1F', 'line-width': 7 } });
}

function rebuildLayersAfterStyleSwitch() {
  addRouteLayers();
  add3DBuildings();
  applyNightFilter();
  if (NAV.route) setRouteSource(NAV.route);
  renderAltLayer();
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }
function lineFC(coords) { return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }; }

function setRouteSource(route) {
  const src = NAV.map && NAV.map.getSource('route');
  if (src) src.setData(lineFC(route.geometry.coordinates));
}

function renderAltLayer() {
  const src = NAV.map && NAV.map.getSource('route-alts');
  if (!src) return;
  const features = NAV.altRoutes
    .map((r, i) => (i === NAV.altIndex ? null : { type: 'Feature', geometry: r.geometry, properties: { idx: i } }))
    .filter(Boolean);
  src.setData({ type: 'FeatureCollection', features });
}

function applyNightFilter() {
  const canvas = document.querySelector('#navMap .maplibregl-canvas');
  if (canvas) canvas.classList.toggle('nav-night-canvas', isNightNow());
  const btn = document.getElementById('navThemeBtn');
  if (btn) btn.textContent = isNightNow() ? '☀️' : '🌙';
}

/* ============================= ROUTE PREVIEW ============================= */

function fitPreview(b) {
  if (!NAV.map) return;
  try {
    NAV.map.fitBounds([[Math.min(NAV.currentLng, b.lng), Math.min(NAV.currentLat, b.lat)], [Math.max(NAV.currentLng, b.lng), Math.max(NAV.currentLat, b.lat)]], { padding: 80, duration: 0 });
  } catch (e) {}
}

async function fetchDirections({ fromLat, fromLng, toLat, toLng, profile, alternatives, waypoint }) {
  const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng, profile });
  if (alternatives) params.set('alternatives', 'true');
  if (waypoint) params.set('waypoints', `${waypoint[0]},${waypoint[1]}`);
  const resp = await fetch('/api/directions?' + params.toString(), { cache: 'no-store' });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Routing failed (${resp.status})`);
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route found.');
  return data.routes;
}

async function computePreviewRoutes(b) {
  const listEl = document.getElementById('navAltList');
  listEl.innerHTML = '<div class="loading">Finding routes…</div>';
  try {
    const routes = await fetchDirections({
      fromLat: NAV.currentLat, fromLng: NAV.currentLng, toLat: b.lat, toLng: b.lng,
      profile: NAV.mode, alternatives: !NAV.waypoint, waypoint: NAV.waypoint,
    });
    NAV.altRoutes = routes;
    NAV.altIndex = 0;
    renderAltPills();
    selectAlt(0);
    document.getElementById('navGoBtn').disabled = false;
  } catch (e) {
    listEl.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
    document.getElementById('navGoBtn').disabled = true;
  }
}

function renderAltPills() {
  const listEl = document.getElementById('navAltList');
  if (!NAV.altRoutes.length) { listEl.innerHTML = '<div class="error-box">No route found.</div>'; return; }
  const fastestIdx = NAV.altRoutes.reduce((best, r, i) => (r.duration < NAV.altRoutes[best].duration ? i : best), 0);
  const shortestIdx = NAV.altRoutes.reduce((best, r, i) => (r.distance < NAV.altRoutes[best].distance ? i : best), 0);
  listEl.innerHTML = NAV.altRoutes.map((r, i) => {
    let tag = '';
    if (NAV.altRoutes.length > 1) tag = i === fastestIdx ? 'Fastest' : i === shortestIdx ? 'Shortest' : 'Alternate';
    return `<button class="nav-alt-pill ${i === NAV.altIndex ? 'active' : ''}" data-idx="${i}">
      <span class="nav-alt-tag">${tag}</span>
      <span class="nav-alt-time">${fmtDuration(r.duration)}</span>
      <span class="nav-alt-dist">${fmtDist(r.distance)}</span>
    </button>`;
  }).join('');
  listEl.querySelectorAll('.nav-alt-pill').forEach((btn) => btn.addEventListener('click', () => selectAlt(Number(btn.dataset.idx))));
}

function selectAlt(i) {
  NAV.altIndex = i;
  NAV.route = NAV.altRoutes[i];
  NAV.coords = NAV.route.geometry.coordinates;
  NAV.steps = extractSteps(NAV.route);
  NAV.stepIndex = 0; NAV.progressIndex = 0;
  renderAltPills();
  setRouteSource(NAV.route);
  renderAltLayer();
  try {
    const bounds = NAV.coords.reduce((bd, c) => bd.extend(c), new maplibregl.LngLatBounds(NAV.coords[0], NAV.coords[0]));
    NAV.map.fitBounds(bounds, { padding: 70, duration: 400 });
  } catch (e) {}
}

function placeStop(lat, lng) {
  NAV.waypoint = [lat, lng];
  NAV.addingStop = false;
  document.getElementById('navAddStopBtn').textContent = '✕ Remove stop';
  document.getElementById('navPreviewHint').textContent = 'Stop added — you\'ll be routed there first, then on to the shop.';
  if (NAV.altMarker) { try { NAV.altMarker.remove(); } catch (e) {} }
  const el = document.createElement('div');
  el.className = 'aliko-stop-pin';
  NAV.altMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(NAV.map);
  computePreviewRoutes(currentBusiness_forNav);
}

/* ============================= GO / LIVE TRACKING ============================= */

function goLive() {
  if (!NAV.route) return;
  NAV.previewing = false;
  NAV.active = true;
  document.getElementById('navPreview').classList.add('hidden');
  document.getElementById('navTopbar').classList.remove('hidden');
  setNavInstruction('↑', 'Starting…', '', '—');
  NAV.map.easeTo({ pitch: 55, zoom: 18, duration: 600 });
  NAV.tripStartAt = Date.now();
  NAV.tripStartDistanceM = NAV.route.distance;

  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ bizId: currentBusiness_forNav.id, name: currentBusiness_forNav.name, at: Date.now() })); } catch (e) {}
  api('/businesses/' + currentBusiness_forNav.id + '/track', { method: 'POST', body: { type: 'navigation' } }).catch(() => {});

  NAV.lastGpsAt = Date.now();
  NAV.watchId = navigator.geolocation.watchPosition(onGpsUpdate, onGpsError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  clearTimeout(NAV.gpsWarnTimer);
  NAV.gpsWarnTimer = setTimeout(gpsWatchdog, 9000);
}

function resetNav() {
  stopWatch();
  NAV.route = null; NAV.coords = []; NAV.steps = []; NAV.stepIndex = 0; NAV.progressIndex = 0;
  NAV.altRoutes = []; NAV.altIndex = 0; NAV.waypoint = null; NAV.addingStop = false;
  NAV.lastRouteAt = 0; NAV.rerouting = false; NAV.userMovedMap = false; NAV.lastSpokenKey = '';
  NAV.currentLat = null; NAV.currentLng = null; NAV.currentBearing = null;
  NAV.speedKmh = 0; NAV.lastSpeedFix = null; NAV.announced = new Set();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (NAV.altMarker) { try { NAV.altMarker.remove(); } catch (e) {} NAV.altMarker = null; }
  if (NAV.marker) { try { NAV.marker.remove(); } catch (e) {} NAV.marker = null; }
  NAV.userMarker = null; // destroyed implicitly when the map below is removed
  if (NAV.map) { try { NAV.map.remove(); } catch (e) {} NAV.map = null; }
}

function stopWatch() {
  if (NAV.watchId !== null) { try { navigator.geolocation.clearWatch(NAV.watchId); } catch (e) {} NAV.watchId = null; }
  clearTimeout(NAV.gpsWarnTimer); NAV.gpsWarnTimer = null;
}

function gpsWatchdog() {
  if (!NAV.active) return;
  if (Date.now() - NAV.lastGpsAt > 9000) showBanner('GPS is taking a while to respond. Waiting for a fix…');
  clearTimeout(NAV.gpsWarnTimer);
  NAV.gpsWarnTimer = setTimeout(gpsWatchdog, 5000);
}

async function onGpsUpdate(pos) {
  if (!NAV.active || !pos || !pos.coords) return;
  const lat = Number(pos.coords.latitude), lng = Number(pos.coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
  const heading = Number.isFinite(pos.coords.heading) && pos.coords.heading >= 0 ? pos.coords.heading : null;
  const now = Date.now();

  NAV.lastGpsAt = now;
  updateGpsPill(accuracy);
  updateSpeed(pos.coords.speed, lat, lng, now);

  if (heading !== null) NAV.currentBearing = heading;
  else if (NAV.currentLat !== null) {
    const brg = bearingBetween(NAV.currentLat, NAV.currentLng, lat, lng);
    if (brg !== null) NAV.currentBearing = brg;
  }

  NAV.currentLat = lat; NAV.currentLng = lng;
  updateUserMarker(lat, lng, NAV.currentBearing);

  if (!NAV.route) return;

  const distToDest = haversine(lat, lng, Number(currentBusiness_forNav.lat), Number(currentBusiness_forNav.lng));
  if (distToDest <= ARRIVAL_M) { handleArrival(); return; }

  const closest = closestOnRoute(lat, lng);
  if (closest.distance > OFF_ROUTE_M) {
    if (!NAV.rerouting && now - NAV.lastRouteAt >= REROUTE_COOLDOWN_MS) { await reroute(lat, lng); return; }
  } else if (accuracy !== null && accuracy <= 50) hideBanner();

  updateStep(lat, lng, closest);
  updateStats(closest);
  updateTraveledLine(closest);
  followCamera(lat, lng, NAV.currentBearing);
}

function onGpsError(err) {
  let msg = 'GPS unavailable.';
  if (err.code === 1) msg = 'Location permission denied — allow access to navigate.';
  else if (err.code === 2) msg = 'Could not determine your location.';
  else if (err.code === 3) msg = 'GPS timed out — still trying…';
  showBanner(msg);
}

function updateSpeed(rawSpeed, lat, lng, now) {
  let mps = Number.isFinite(rawSpeed) && rawSpeed >= 0 ? rawSpeed : null;
  if (mps === null && NAV.lastSpeedFix) {
    const dt = (now - NAV.lastSpeedFix.t) / 1000;
    if (dt > 0.5) mps = haversine(NAV.lastSpeedFix.lat, NAV.lastSpeedFix.lng, lat, lng) / dt;
  }
  NAV.lastSpeedFix = { lat, lng, t: now };
  if (mps !== null) NAV.speedKmh = mps * 3.6;
  const el = document.getElementById('navSpeed');
  if (el) el.textContent = mps === null ? '' : '· ' + fmtSpeed(NAV.speedKmh);
}

async function reroute(lat, lng) {
  if (NAV.rerouting) return;
  NAV.rerouting = true;
  showBanner('You left the route — recalculating…', true);
  try {
    const routes = await fetchDirections({
      fromLat: lat, fromLng: lng, toLat: currentBusiness_forNav.lat, toLng: currentBusiness_forNav.lng,
      profile: NAV.mode, alternatives: false, waypoint: NAV.waypoint,
    });
    NAV.route = routes[0];
    NAV.coords = NAV.route.geometry.coordinates;
    NAV.steps = extractSteps(NAV.route);
    NAV.stepIndex = 0; NAV.progressIndex = 0; NAV.lastRouteAt = Date.now();
    NAV.altRoutes = [NAV.route]; NAV.altIndex = 0;
    setRouteSource(NAV.route);
    renderAltLayer();
    updateStats();
    hideBanner();
  } catch (e) {
    showBanner('Route problem: ' + e.message);
  } finally {
    NAV.rerouting = false;
  }
}

/* ============================= STEPS / INSTRUCTIONS ============================= */

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
  let duration = remainingDuration();
  // Blend the OSRM duration estimate with actual current speed when we have a good fix.
  if (NAV.speedKmh > 3) {
    const speedBased = (remaining / (NAV.speedKmh / 3.6));
    duration = duration > 0 ? duration * 0.5 + speedBased * 0.5 : speedBased;
  }
  document.getElementById('navRemaining').textContent = fmtDist(remaining);
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
    NAV.announced.clear();
  }

  const dist = haversine(lat, lng, step.lat, step.lng);
  setNavInstruction(maneuverIcon(step), maneuverText(step), step.name || '', fmtDist(dist));
  updateNextUp();
  speak(step, dist);
}

function updateNextUp() {
  const el = document.getElementById('navNextUp');
  const next = NAV.steps[NAV.stepIndex + 1];
  if (!next || next.type === 'arrive') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  document.getElementById('navNextText').textContent = `${maneuverText(next)}${next.name ? ' onto ' + next.name : ''}`;
}

function maneuverText(step) {
  const type = (step.type || '').toLowerCase(), mod = (step.modifier || '').toLowerCase();
  if (type === 'depart') return 'Start ' + (NAV.mode === 'foot' ? 'walking' : 'driving');
  if (type === 'arrive') return 'Arrive at destination';
  if (type === 'roundabout' || type === 'rotary') return step.exit ? 'Take exit ' + step.exit : 'Enter roundabout';
  if (type === 'uturn') return 'Make a U-turn';
  if (mod === 'left' || mod === 'slight left') return mod === 'slight left' ? 'Bear left' : 'Turn left';
  if (mod === 'right' || mod === 'slight right') return mod === 'slight right' ? 'Bear right' : 'Turn right';
  if (mod === 'straight') return 'Continue straight';
  return 'Continue';
}
function maneuverIcon(step) {
  const type = (step.type || '').toLowerCase(), mod = (step.modifier || '').toLowerCase();
  if (type === 'arrive') return '✓';
  if (type === 'roundabout' || type === 'rotary') return '⟳';
  if (type === 'uturn') return '↶';
  if (mod === 'left' || mod === 'slight left') return mod === 'slight left' ? '↖' : '←';
  if (mod === 'right' || mod === 'slight right') return mod === 'slight right' ? '↗' : '→';
  return '↑';
}

function speak(step, dist) {
  if (!NAV.speech || !window.speechSynthesis) return;
  const crossed = VOICE_THRESHOLDS_M.find((t) => dist <= t);
  if (!crossed) return;
  const key = NAV.stepIndex + ':' + crossed;
  if (NAV.announced.has(key)) return;
  NAV.announced.add(key);
  speakNow(maneuverText(step) + (step.name ? ' onto ' + step.name : '') + (crossed > 60 ? ' in ' + fmtDist(dist) : ' now'));
}
function speakNow(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}
function repeatInstruction() {
  if (!NAV.steps.length) return;
  const step = NAV.steps[NAV.stepIndex];
  const dist = NAV.currentLat !== null ? haversine(NAV.currentLat, NAV.currentLng, step.lat, step.lng) : step.distance;
  speakNow(maneuverText(step) + (step.name ? ' onto ' + step.name : '') + ', ' + fmtDist(dist) + '.');
}

/* ============================= GEOMETRY HELPERS ============================= */

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

function updateTraveledLine(closest) {
  const src = NAV.map && NAV.map.getSource('route-done');
  if (!src || !closest || !closest.point || closest.index < 0) return;
  const done = NAV.coords.slice(0, closest.index + 1).concat([[closest.point[1], closest.point[0]]]);
  src.setData(lineFC(done));
}

/* ============================= CAMERA / MARKER ============================= */

function updateUserMarker(lat, lng, bearing) {
  if (!NAV.map) return;
  const rot = Number.isFinite(bearing) ? bearing : 0;
  if (!NAV.userMarker) {
    const el = document.createElement('div');
    el.className = 'aliko-live-marker';
    el.innerHTML = `<div class="cone"></div><div class="pulse"></div><div class="dot"></div>`;
    NAV.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(NAV.map);
  } else {
    NAV.userMarker.setLngLat([lng, lat]);
  }
  const cone = NAV.userMarker.getElement().querySelector('.cone');
  if (cone) cone.style.transform = `translateX(-50%) rotate(${rot}deg)`;
}

function followCamera(lat, lng, bearing, force) {
  if (!NAV.map || lat == null || (NAV.userMovedMap && !force)) return;
  try {
    NAV.map.easeTo({
      center: [lng, lat],
      bearing: NAV.headingUp && Number.isFinite(bearing) ? bearing : 0,
      pitch: NAV.headingUp ? 55 : 0,
      duration: force ? 0 : 700,
      essential: true,
    });
  } catch (e) {}
}

/* ============================= UI HELPERS ============================= */

function updateGpsPill(accuracy) {
  const dot = document.getElementById('navGpsDot'), text = document.getElementById('navGpsText'), accEl = document.getElementById('navAccuracy');
  if (accuracy === null) { dot.className = 'nav-gps-dot bad'; text.textContent = 'NO GPS'; return; }
  if (accuracy <= 15) { dot.className = 'nav-gps-dot'; text.textContent = 'GPS'; }
  else if (accuracy <= 40) { dot.className = 'nav-gps-dot warn'; text.textContent = 'WEAK'; }
  else { dot.className = 'nav-gps-dot bad'; text.textContent = 'POOR'; }
  if (accEl) accEl.textContent = Math.round(accuracy) + 'm';
}

function setNavInstruction(icon, main, road, dist) {
  document.getElementById('navIcon').textContent = icon || '↑';
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
  try { localStorage.removeItem(RESUME_KEY); } catch (e) {}
  api('/businesses/' + currentBusiness_forNav.id + '/arrival', { method: 'POST', body: { found: true } }).catch(() => {});
  showArrivalCard(currentBusiness_forNav, true);
}

function tripSummaryHtml() {
  if (!NAV.tripStartAt) return '';
  const elapsedS = Math.max(1, (Date.now() - NAV.tripStartAt) / 1000);
  const avgKmh = (NAV.tripStartDistanceM / 1000) / (elapsedS / 3600);
  const mins = Math.round(elapsedS / 60);
  return `<div class="trip-summary">
    <div><strong>${mins < 1 ? '<1' : mins}</strong><span>min trip</span></div>
    <div><strong>${fmtDist(NAV.tripStartDistanceM)}</strong><span>covered</span></div>
    <div><strong>${Math.round(avgKmh)}</strong><span>avg ${NAV.units === 'imperial' ? 'mph' : 'km/h'}</span></div>
  </div>`;
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
      ${arrived ? tripSummaryHtml() : ''}
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
  NAV.active = false; NAV.previewing = false;
  stopWatch();
  try { localStorage.removeItem(RESUME_KEY); } catch (e) {}
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  document.getElementById('navPanel').classList.add('hidden');
  document.getElementById('navPreview').classList.add('hidden');
  document.body.classList.remove('nav-open');
  const card = document.getElementById('arrivalCard');
  if (card) card.className = 'hidden';
  resetNav();
}

/* ============================= RESUME BANNER ============================= */

function checkResumableNav(b) {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return;
    const info = JSON.parse(raw);
    if (!info || info.bizId != b.id || Date.now() - info.at > 2 * 60 * 60 * 1000) { localStorage.removeItem(RESUME_KEY); return; }
    const bar = document.getElementById('navResumeBar');
    bar.className = 'nav-resume-bar';
    bar.innerHTML = `Resume navigation to <strong>${escapeHtml(info.name)}</strong>? <button class="btn small" id="navResumeGo">Resume</button> <button class="btn small ghost" id="navResumeDismiss">Dismiss</button>`;
    document.getElementById('navResumeGo').addEventListener('click', () => { bar.className = 'hidden'; startNavigation(b); });
    document.getElementById('navResumeDismiss').addEventListener('click', () => { bar.className = 'hidden'; localStorage.removeItem(RESUME_KEY); });
  } catch (e) {}
}

/* ============================= FORMATTING ============================= */

function fmtDist(m) {
  if (m == null || !Number.isFinite(Number(m))) return '—';
  m = Number(m);
  if (NAV.units === 'imperial') {
    const ft = m / FT;
    if (ft < 528) return Math.round(ft / 10) * 10 + ' ft';
    return (m / MI).toFixed(m / MI < 10 ? 1 : 0) + ' mi';
  }
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
}
function fmtSpeed(kmh) {
  if (!Number.isFinite(kmh)) return '';
  return NAV.units === 'imperial' ? Math.round(kmh / 1.609) + ' mph' : Math.round(kmh) + ' km/h';
}
function fmtDuration(s) {
  s = Number(s) || 0;
  const mins = Math.round(s / 60);
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
}
function setUnitsButtonLabel() {
  const btn = document.getElementById('navUnitsBtn');
  if (btn) btn.textContent = NAV.units === 'imperial' ? 'mi' : 'km';
}

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

/* ============================= WIRE UP UI ============================= */

document.getElementById('navExitBtn').addEventListener('click', exitNavigation);
document.getElementById('navPreviewCloseBtn').addEventListener('click', exitNavigation);
document.getElementById('navStopBtn').addEventListener('click', exitNavigation);
document.getElementById('navGoBtn').addEventListener('click', goLive);

document.getElementById('navMuteBtn').addEventListener('click', (e) => {
  NAV.speech = !NAV.speech;
  e.target.textContent = NAV.speech ? '🔊 Voice ON' : '🔇 Voice';
  if (!NAV.speech && window.speechSynthesis) window.speechSynthesis.cancel();
});
document.getElementById('navRepeatBtn').addEventListener('click', repeatInstruction);
document.getElementById('navDetailsBtn').addEventListener('click', () => { if (currentBusiness_forNav) showArrivalCard(currentBusiness_forNav, false); });
document.getElementById('navRecenterBtn').addEventListener('click', () => {
  NAV.userMovedMap = false;
  if (NAV.currentLat !== null) followCamera(NAV.currentLat, NAV.currentLng, NAV.currentBearing, true);
});

document.getElementById('navHeadingBtn').addEventListener('click', (e) => {
  NAV.headingUp = !NAV.headingUp;
  try { localStorage.setItem('aliko_nav_headingup', NAV.headingUp ? 'on' : 'off'); } catch (err) {}
  e.target.classList.toggle('active', NAV.headingUp);
  if (NAV.currentLat !== null) followCamera(NAV.currentLat, NAV.currentLng, NAV.currentBearing, true);
});
document.getElementById('navStyleBtn').addEventListener('click', () => {
  NAV.styleIndex = (NAV.styleIndex + 1) % MAP_STYLES.length;
  try { localStorage.setItem('aliko_nav_style', MAP_STYLES[NAV.styleIndex].id); } catch (e) {}
  if (NAV.map) { NAV.map.setStyle(MAP_STYLES[NAV.styleIndex].url); NAV.map.once('style.load', rebuildLayersAfterStyleSwitch); }
  toast('Map style: ' + MAP_STYLES[NAV.styleIndex].label);
});
document.getElementById('navThemeBtn').addEventListener('click', () => {
  NAV.night = !isNightNow();
  try { localStorage.setItem('aliko_nav_theme', NAV.night ? 'night' : 'day'); } catch (e) {}
  applyNightFilter();
});
document.getElementById('navUnitsBtn').addEventListener('click', () => {
  NAV.units = NAV.units === 'imperial' ? 'metric' : 'imperial';
  try { localStorage.setItem('aliko_nav_units', NAV.units); } catch (e) {}
  setUnitsButtonLabel();
  updateStats();
});
document.getElementById('navShareBtn').addEventListener('click', async () => {
  if (!currentBusiness_forNav) return;
  const etaEl = document.getElementById('navEta');
  const eta = etaEl ? etaEl.textContent : '';
  const text = `I'm heading to ${currentBusiness_forNav.name}${eta && eta !== '—' ? ', arriving around ' + eta : ''}. (This is a one-off share, not a live tracking link.)`;
  if (navigator.share) navigator.share({ title: 'My ETA', text }).catch(() => {});
  else { await navigator.clipboard.writeText(text).catch(() => {}); toast('ETA copied to clipboard.'); }
});

document.getElementById('navModeRow').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-mode-btn');
  if (btn) {
    NAV.mode = btn.dataset.mode;
    document.querySelectorAll('.nav-mode-btn').forEach((x) => x.classList.toggle('active', x === btn));
    if (currentBusiness_forNav) computePreviewRoutes(currentBusiness_forNav);
    return;
  }
  if (e.target.id === 'navAddStopBtn') {
    if (NAV.waypoint) {
      NAV.waypoint = null;
      document.getElementById('navAddStopBtn').textContent = '+ Add a stop';
      document.getElementById('navPreviewHint').textContent = "Tap the map to drop a stop (e.g. where you'll park) before you go.";
      if (NAV.altMarker) { try { NAV.altMarker.remove(); } catch (err) {} NAV.altMarker = null; }
      if (currentBusiness_forNav) computePreviewRoutes(currentBusiness_forNav);
    } else {
      NAV.addingStop = true;
      document.getElementById('navPreviewHint').textContent = 'Tap anywhere on the map to place your stop…';
    }
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (NAV.active || NAV.previewing)) exitNavigation(); });
window.addEventListener('beforeunload', () => { stopWatch(); if (window.speechSynthesis) window.speechSynthesis.cancel(); });
