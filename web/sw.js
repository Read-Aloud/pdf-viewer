const CACHE_NAME = 'readaloud-v1';

const PRECACHE_URLS = [
  './readaloud.html',
  './viewer.js',
  './viewer.css',
  './readaloud.js',
  './debugger.js',
  './debugger.css',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.1.81/build/pdf.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.1.81/build/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.1.81/build/pdf.sandbox.min.js',
  'https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js',
  'https://ajax.googleapis.com/ajax/libs/jqueryui/1.12.1/jquery-ui.min.js',
  'https://ajax.googleapis.com/ajax/libs/jqueryui/1.12.1/themes/smoothness/jquery-ui.css',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(PRECACHE_URLS);
      })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    })
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200) {
          return response;
        }
        var responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    })
  );
});
