/**
 * MK Opulence PWA Service Worker
 * Network-first for HTML/API, cache-first for fonts only
 * Updates show immediately — cache is only for offline fallback
 */

const CACHE_NAME = 'mk-opulence-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Cache-first ONLY for fonts (they never change)
  if (url.origin.includes('googleapis.com') || url.origin.includes('gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(r => r || fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }))
    );
    return;
  }

  // Network-first for EVERYTHING else (HTML, API, icons, etc.)
  // Cache response for offline fallback only
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
