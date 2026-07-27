/**
 * Minimal hand-rolled service worker — no build plugin, no persisted
 * dependency, consistent with the rest of this project. Strategy: serve
 * from cache immediately if present (instant, works offline), and always
 * refresh the cache from the network in the background when online.
 *
 * CACHE_NAME below is a dev-only placeholder — `npm run build` (via
 * scripts/stamp-sw-cache.ts) rewrites it in dist/sw.js to a hash of the
 * built assets on every build, so every deploy that actually changes JS/CSS
 * gets a fresh cache name and old caches get swept on the next activate.
 * This file (public/sw.js) stays unstamped for `npm run dev`, where cache
 * busting doesn't matter the same way.
 */
const CACHE_NAME = 'book-cricket-v1';
const PRECACHE = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A new worker now parks in "installed"/waiting instead of activating
// itself immediately — main.ts shows an update toast and only sends this
// once the player taps it, so a background update can never yank the
// bundle out from under a live flip.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // leave fonts.googleapis etc. alone

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
