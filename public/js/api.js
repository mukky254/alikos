// public/js/api.js
const TOKEN_KEY = 'aliko_token';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && Date.now() / 1000 > payload.exp) { clearToken(); return null; }
    return payload;
  } catch (e) { return null; }
}
function logout() { clearToken(); window.location.href = 'index.html'; }

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch('/api' + path, { ...opts, headers, body });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#171B23;color:#F4F5F7;padding:12px 20px;border-radius:999px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.4);z-index:9999;opacity:0;pointer-events:none;transition:opacity .25s;border:1px solid rgba(255,255,255,.12);';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDist(km) {
  if (km == null) return '';
  return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km';
}
