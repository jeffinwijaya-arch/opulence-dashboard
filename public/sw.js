// v4 — Nuclear reset: unregister self and clear all caches
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.matchAll())
      .then(clients => clients.forEach(c => c.navigate(c.url)))
      .then(() => self.registration.unregister())
  );
});
// No fetch handler — everything goes straight to network
