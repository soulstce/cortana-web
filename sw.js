const CACHE = 'cortana-web-v3';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];
self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE).then(function(cache) { return cache.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) { return key !== CACHE; }).map(function(key) { return caches.delete(key); }));
  }));
  self.clients.claim();
});
self.addEventListener('fetch', function(event) {
  event.respondWith(caches.match(event.request).then(function(cached) { return cached || fetch(event.request); }));
});
