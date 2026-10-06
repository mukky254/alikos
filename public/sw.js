// Aliko service worker — caches the static app shell so the site's own
// pages/scripts/styles still load when offline or on a flaky connection.
// API calls (/api/...) are always fetched fresh — this never serves stale
// business data, only static files.
const CACHE_NAME = 'aliko-shell-v1';
const SHELL_FILES = [
  '/', '/index.html', '/business.html', '/saved.html', '/deals.html', '/dashboard.html',
  '/account.html', '/login.html', '/signup.html', '/register.html', '/profile.html', '/messages.html', '/track.html',
  '/css/style.css', '/css/shared.css',
  '/js/api.js', '/js/nav.js', '/js/shared.js', '/js/home.js',
  '/manifest.json',
];

// Feature: offline map tile caching. Map tiles, the MapLibre GL library,
// and the style/sprite/glyph files it loads are cached separately from
// the app shell, stale-while-revalidate — meaning a route you've already
// navigated stays viewable on a flaky or lost connection, since the
// tiles you actually saw are already on the device. This is NOT a full
// pre-fetch of an entire route corridor ahead of time (that would need
// computing the route's bounding box and warming every tile in it before
// you leave) — it's "what you've seen stays available", which is the
// realistic, honest version of this without a lot of added complexity.
const TILE_CACHE_NAME = 'aliko-tiles-v1';
const CACHEABLE_TILE_ORIGINS = ['https://tiles.openfreemap.org', 'https://unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // never cache live data

  // Fix: when a request isn't cached yet AND the network fetch fails
  // (offline, DNS hiccup, etc.), the old code's `.catch(() => cached)`
  // returned `undefined` — but respondWith() requires an actual Response
  // object, never undefined, which is exactly what threw "Failed to
  // convert value to 'Response'" and crashed the fetch. Restructured so
  // every code path resolves to a real Response: serve the cached copy
  // immediately when one exists (refreshing it in the background,
  // without blocking the response on that refresh), and only hit the
  // network when there's nothing cached — with a real fallback Response
  // if even that fails.
  if (CACHEABLE_TILE_ORIGINS.some((o) => url.href.startsWith(o))) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) {
            fetch(event.request).then((resp) => { if (resp && resp.ok) cache.put(event.request, resp); }).catch(() => {});
            return cached;
          }
          return fetch(event.request)
            .then((resp) => { if (resp && resp.ok) cache.put(event.request, resp.clone()); return resp; })
            .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // other cross-origin requests pass through untouched

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        fetch(event.request).then((resp) => {
          if (resp && resp.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resp));
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => new Response('<h1>You appear to be offline</h1><p>This page needs a connection and wasn\'t cached yet.</p>', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html' } }));
    })
  );
});
