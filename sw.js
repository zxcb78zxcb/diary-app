/* 离线缓存。改了 index.html / sync-core.js 之后，把 VERSION 加一 */
const VERSION = 'diary-v2';
const FILES = ['./', 'index.html', 'sync-core.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // GitHub API 永远走网络，绝不缓存
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 页面文件：先用网络（保证能拿到新版），失败再用缓存
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
