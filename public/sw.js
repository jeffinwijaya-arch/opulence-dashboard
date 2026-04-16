// Opulence Dashboard — Service Worker v6
//
// Caches the app shell (index.html, bundle.json, modules) so the
// PWA never shows iOS Safari's native "Failed to load / Retry"
// overlay when the network is flaky. Uses a network-first strategy
// for the shell: when the network succeeds, serve the fresh response
// and update the cache; when the network fails, serve the cached
// version. This means the user always gets the newest deploy, and
// only falls back to cached content when offline.
//
// /api/* and /data/*.json use stale-while-revalidate: serve the
// cached version instantly (for snappy UX) then update the cache
// in the background from the network.
//
// This replaces v5 which was a self-destruct no-op. v5 deliberately
// unregistered itself because an earlier service worker was
// aggressively caching stale HTML. This version is careful to keep
// the shell cache small and fresh.

const CACHE_NAME = 'mk-shell-v7';

// Files to pre-cache on install. These are the minimum set required
// for the PWA to render *something* instead of iOS's error page.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/data/bundle.json',
  '/manifest.json',
  '/icon-192.png',
  '/modules/module-loader.js',
  '/modules/ws1-price-intel.js',
  '/modules/ws2-inventory-pnl.js',
  '/modules/ws3-deal-flow.js',
  '/modules/ws4-posting.js',
  '/modules/ws5-shipping.js',
  '/modules/ws6-crm.js',
  '/modules/ws7-analytics.js',
  '/modules/ws8-mobile-ux.js',
  '/modules/ws9-reporting.js',
  '/modules/ws10-automation.js',
  '/enhanced-pricing.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Delete old caches from previous versions (including the v5
  // self-destruct cache remnants).
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Strategy 1: Network-first for the HTML shell.
  // Why: we ALWAYS want the newest deploy to win, but we need a
  // fallback for when the user is offline or CDN is down (which is
  // exactly when iOS shows "Failed to load").
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Strategy 2: Stale-while-revalidate for data + modules.
  // Why: serve instantly from cache (so the dashboard feels snappy),
  // then update the cache in the background from the network.
  if (url.pathname.startsWith('/data/') ||
      url.pathname.startsWith('/modules/') ||
      url.pathname.startsWith('/api/') ||
      url.pathname === '/enhanced-pricing.js' ||
      url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // Network failed — return cached version or a JSON error
            // that won't crash the caller's .json() parse.
            if (cached) return cached;
            if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
              return new Response(
                JSON.stringify({ ok: false, error: 'offline', cached: false }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            }
            return new Response('', { status: 503 });
          });
        // Return cached immediately if available, otherwise wait for network.
        return cached || networkFetch;
      })
    );
    return;
  }

  // Strategy 3: Cache-first for static assets (icons, fonts, images).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
