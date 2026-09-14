const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

// Falls back to the free public OSRM demo if OSRM_URL isn't set — so a
// deployment that forgets to configure OSRM_URL still routes (with the
// public demo's car-only, fair-use limits) instead of silently trying to
// reach localhost on the server itself. Your own .env can still point
// OSRM_URL at your self-hosted Docker instance for local dev.
const OSRM_URL = () => (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validCoord(lat, lng) {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function osrm(path, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${OSRM_URL()}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}
    if (!resp.ok) throw new Error(`Routing service returned ${resp.status}.`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Routing service timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Parses an optional "lat,lng;lat,lng" via-point list (used for the "add a stop"
// feature, e.g. routing through a parking spot before walking to the exact shop).
function parseWaypoints(raw) {
  const str = String(raw || '').trim();
  if (!str) return [];
  const stops = [];
  for (const pair of str.split(';')) {
    const [latS, lngS] = pair.split(',');
    const lat = num(latS), lng = num(lngS);
    if (!validCoord(lat, lng)) return null; // signal invalid input
    stops.push([lng, lat]);
  }
  return stops.slice(0, 3); // keep it sane — max 3 extra stops
}

router.get('/', async (req, res) => {
  const fromLat = num(req.query.fromLat), fromLng = num(req.query.fromLng);
  const toLat = num(req.query.toLat), toLng = num(req.query.toLng);
  if (!validCoord(fromLat, fromLng) || !validCoord(toLat, toLng)) {
    return res.status(400).json({ error: 'Valid origin and destination coordinates are required.' });
  }
  const profile = req.query.profile === 'foot' ? 'foot' : 'driving';
  const waypoints = parseWaypoints(req.query.waypoints);
  if (waypoints === null) return res.status(400).json({ error: 'waypoints must be lat,lng pairs separated by ;' });
  // OSRM only computes alternatives for a simple A->B request (no via points).
  const alternatives = waypoints.length === 0 && req.query.alternatives === 'true' ? 'true' : 'false';
  const accuracy = num(req.query.accuracy);
  const heading = num(req.query.heading);
  const routeOptions = new URLSearchParams({ overview:'full', geometries:'geojson', steps:'true', annotations:'true', alternatives });
  if (accuracy !== null) routeOptions.set('radiuses', `${Math.min(100, Math.max(5, accuracy))};100`);
  if (heading !== null && heading >= 0 && heading <= 360) {
    const bearingParts = [`${Math.round(heading)},45`];
    for (let i = 0; i < waypoints.length; i++) bearingParts.push('0,180');
    bearingParts.push('0,180');
    routeOptions.set('bearings', bearingParts.join(';'));
  }
  const allCoords = [[fromLng, fromLat], ...waypoints, [toLng, toLat]].map((c) => c.join(',')).join(';');
  const path = `/route/v1/${profile}/${allCoords}?${routeOptions.toString()}`;
  try {
    const data = await osrm(path);
    if (data.code !== 'Ok' || !data.routes?.length) return res.status(404).json({ error: 'No route found between those points.' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Could not reach routing service: ${e.message}` });
  }
});

// Snap one coordinate to the nearest routable road. Useful for validating an exact
// business point and for showing the road-side approach separately from the shop itself.
router.get('/nearest', async (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  if (!validCoord(lat, lng)) return res.status(400).json({ error: 'Valid lat and lng are required.' });
  try {
    const data = await osrm(`/nearest/v1/driving/${lng},${lat}?number=3`, 7000);
    if (data.code !== 'Ok' || !data.waypoints?.length) return res.status(404).json({ error: 'No nearby road was found.' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Could not snap location to the road: ${e.message}` });
  }
});

// GPS trace -> road-matched coordinates. This is one of the biggest accuracy upgrades
// for a browser navigation experience because raw phone GPS can jump between parallel roads.
router.get('/match', async (req, res) => {
  const raw = String(req.query.coordinates || '').trim();
  if (!raw) return res.status(400).json({ error: 'coordinates is required.' });
  const pairs = raw.split(';').slice(-80);
  if (pairs.length < 2 || pairs.some((p) => {
    const [lng, lat] = p.split(',').map(Number);
    return !validCoord(lat, lng);
  })) return res.status(400).json({ error: 'coordinates must contain valid lng,lat pairs.' });

  try {
    const timestamps = String(req.query.timestamps || '').trim();
    const radiuses = String(req.query.radiuses || '').trim();
    const bearings = String(req.query.bearings || '').trim();
    const gaps = String(req.query.gaps || 'ignore') === 'split' ? 'split' : 'ignore';
    const matchOptions = new URLSearchParams({
      overview: 'full',
      geometries: 'geojson',
      steps: 'false',
      annotations: 'true',
      tidy: 'true',
      gaps
    });
    if (timestamps) matchOptions.set('timestamps', timestamps);
    if (radiuses) matchOptions.set('radiuses', radiuses);
    if (bearings) matchOptions.set('bearings', bearings);
    const data = await osrm(`/match/v1/driving/${pairs.join(';')}?${matchOptions.toString()}`, 10000);
    if (data.code !== 'Ok' || !data.matchings?.length) return res.status(404).json({ error: 'No road match found.' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Could not match GPS trace: ${e.message}` });
  }
});

module.exports = router;
