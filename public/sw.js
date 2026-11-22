/*
 * Forgeborn service worker: makes the installed app load instantly and play offline.
 *  - Page navigations: network first (so updates arrive), falling back to the cached page.
 *  - Hashed build assets (JS/CSS) and icons: cache first; they never change once built.
 *  - Unhashed files (sprite sheets, sprites.json): network first, cached copy when offline.
 * Bump VERSION to force old caches out after a breaking change.
 */
const VERSION = 'forgeborn-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  const store = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  };
  // Hashed build output and icons never change: cache first. Everything else (sprite sheets,
  // sprites.json, manifest) keeps its name when updated: network first, cache when offline.
  const path = new URL(req.url).pathname;
  if (path.includes('/assets/') || path.includes('/icons/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(store)));
  } else {
    event.respondWith(fetch(req).then(store).catch(() => caches.match(req)));
  }
});
