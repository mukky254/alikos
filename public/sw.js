// Aliko service worker — caches the static app shell so the site's own
// pages/scripts/styles still load when offline or on a flaky connection.
// API calls (/api/...) are always fetched fresh — this never serves stale
// business data, only static files.
const CACHE_NAME = 'aliko-shell-v1';
const SHELL_FILES = [
  '/index.html', '/business.html', '/saved.html', '/deals.html', '/dashboard.html',
  '/account.html', '/login.html', '/signup.html', '/register.html',
  '/css/style.css', '/css/shared.css',
  '/js/api.js', '/js/nav.js', '/js/shared.js', '/js/home.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // never cache live data
  if (url.origin !== self.location.origin) return; // don't intercept CDN/tile requests

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
