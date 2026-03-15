// v5 — Self-destruct: unregister and clear all caches immediately
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
self.addEventListener('fetch', () => {}); // no-op, pass through to network
