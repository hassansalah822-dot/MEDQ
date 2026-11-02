// sw.js
const CACHE_NAME = 'medq-offline-cache-v10';

const staticAssets = [
  './',
  './index.html',
  './login.html',
  './register.html',
  './dashboard.html',
  './admin.html',
  './question.html',
  './performance.html',
  './1000004103_2.png',
  './js/firebase-config.js',
  './js/auth.js',
  './js/register.js',
  './js/dashboard.js',
  './js/admin.js',
  './js/question.js',
  './js/performance.js',
  './1.mp3', 
  './2.mp3', 
  './5.mp3', 
  './6.mp3'
].map(url => new URL(url, self.location).href);

self.addEventListener('install', (event) => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => {
      if (key !== CACHE_NAME) return caches.delete(key);
    })))
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'cacheAppFiles') {
      caches.open(CACHE_NAME).then(cache => cache.addAll(staticAssets));
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('identitytoolkit.googleapis.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200 && event.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match(new URL('./dashboard.html', self.location).href);
      });
    })
  );
});
