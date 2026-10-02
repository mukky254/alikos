// public/js/track.js
renderNav('');

const token = new URLSearchParams(window.location.search).get('token');
const statusEl = document.getElementById('trackStatus');
let map = null, marker = null, destMarker = null, pollTimer = null;

async function poll() {
  if (!token) { statusEl.textContent = 'No tracking link provided.'; return; }
  try {
    const data = await fetch('/api/live/' + token).then((r) => r.json().then((body) => ({ ok: r.ok, body })));
    if (!data.ok) { statusEl.textContent = data.body.error || 'This link is no longer active.'; clearInterval(pollTimer); return; }
    const { lat, lng, updatedAt, expiresAt, business } = data.body;

    if (!map) {
      map = L.map('trackMap').setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
      marker = L.marker([lat, lng]).addTo(map);
      if (business) {
        destMarker = L.marker([business.lat, business.lng], { opacity: 0.8 }).addTo(map).bindPopup(escapeHtml(business.name));
        map.fitBounds(L.featureGroup([marker, destMarker]).getBounds().pad(0.3));
      }
    } else {
      marker.setLatLng([lat, lng]);
    }

    const secsAgo = Math.round((Date.now() - updatedAt) / 1000);
    const minsLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
    statusEl.textContent = `${business ? 'Heading to ' + business.name + ' · ' : ''}Updated ${secsAgo < 5 ? 'just now' : secsAgo + 's ago'} · Link active for ${minsLeft} more min`;
  } catch (e) {
    statusEl.textContent = 'Could not load this location right now.';
  }
}

poll();
pollTimer = setInterval(poll, 5000);
