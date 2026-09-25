// public/js/register.js
renderNav('register');
requireLogin();

// Fix: phone/WhatsApp now collected as country-code + local-number pairs,
// combined into a proper international (+254...) format on submit —
// wa.me and tel: links silently fail or misroute without this.
document.getElementById('phoneFieldsMount').innerHTML =
  countryPhoneFieldHTML('f-phone', 'Phone', '') +
  countryPhoneFieldHTML('f-whatsapp', 'WhatsApp', '');

async function checkDuplicate() {
  const name = document.getElementById('f-name').value.trim();
  const building = document.getElementById('f-building').value.trim();
  const box = document.getElementById('dupWarning');
  if (!name || name.length < 3) { box.innerHTML = ''; return; }
  try {
    const { matches } = await api('/businesses/check-duplicate?name=' + encodeURIComponent(name) + '&building=' + encodeURIComponent(building));
    box.innerHTML = matches.length ? `<div class="note" style="margin-top:8px;">⚠ Similar listing found: ${matches.map((m) => escapeHtml(m.name)).join(', ')}. If this is yours, use "Claim this business" on its profile instead.</div>` : '';
  } catch (e) { box.innerHTML = ''; }
}
document.getElementById('f-name').addEventListener('blur', checkDuplicate);
document.getElementById('f-building').addEventListener('blur', checkDuplicate);

document.getElementById('captureGpsBtn').addEventListener('click', () => {
  const status = document.getElementById('gpsStatus');
  if (!navigator.geolocation) { status.textContent = 'Geolocation not supported.'; return; }
  status.textContent = 'Capturing…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('f-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('f-lng').value = pos.coords.longitude.toFixed(6);
      status.textContent = `Captured: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy)}m)`;
    },
    (err) => { status.textContent = 'Could not capture GPS (' + err.message + '). Enter manually.'; },
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById('f-name').value.trim(),
    category: document.getElementById('f-category').value,
    phone: readCountryPhoneField('f-phone'),
    whatsapp: readCountryPhoneField('f-whatsapp'),
    description: document.getElementById('f-desc').value.trim(),
    tags: document.getElementById('f-tags').value.trim(),
    lat: document.getElementById('f-lat').value,
    lng: document.getElementById('f-lng').value,
    building: document.getElementById('f-building').value.trim(),
    floor: document.getElementById('f-floor').value.trim(),
    shop: document.getElementById('f-shop').value.trim(),
    entrance: document.getElementById('f-entrance').value.trim(),
    landmark: document.getElementById('f-landmark').value.trim(),
  };
  try {
    const { business } = await api('/businesses', { method: 'POST', body });
    toast('Submitted! Pending verification.');
    window.location.href = 'dashboard.html?highlight=' + business.id;
  } catch (err) {
    document.getElementById('errorBox').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
});
