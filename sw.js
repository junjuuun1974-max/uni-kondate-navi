/**
 * sw.js - Uni献立ナビ v3 Service Worker
 */
var CACHE_VERSION = 'v7';
var CACHE_NAME = 'uni-kondate-navi-' + CACHE_VERSION;
var PRECACHE_URLS = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
];
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function() { return self.skipWaiting(); })
      .catch(function(err) { console.warn('[SW] Precache failed:', err); })
  );
});
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n.startsWith('uni-kondate-navi-') && n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match('./index.html');
      });
    })
  );
});
