/* =============================================================
   Mohamed Nour Oils - Service Worker
   Strategy: cache-first for static, network-first for HTML
   ============================================================= */

const CACHE_VERSION = 'mn-oils-v1.1.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

/* --- INSTALL: pre-cache core assets --- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {
        // Some assets may 404; add individually to avoid total failure
        return Promise.all(
          CORE_ASSETS.map(u => cache.add(u).catch(() => null))
        );
      }))
      .then(() => self.skipWaiting())
  );
});

/* --- ACTIVATE: remove old caches --- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* --- FETCH: hybrid strategy --- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.headers.get('accept') &&
                 req.headers.get('accept').includes('text/html');
  const isSameOrigin = url.origin === self.location.origin;
  const isFont = url.host.includes('fonts.googleapis.com') ||
                 url.host.includes('fonts.gstatic.com');

  // Network-first for data.json (always get fresh prices)
  if (url.pathname.endsWith('/data.json') || url.pathname === 'data.json') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, copy).catch(() => {}));
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Network-first for HTML (always get latest prices)
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy).catch(() => {}));
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./')))
    );
    return;
  }

  // Cache-first for same-origin assets and Google Fonts
  if (isSameOrigin || isFont) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, copy).catch(() => {}));
          }
          return resp;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

/* --- MESSAGE: allow page to trigger skipWaiting --- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
