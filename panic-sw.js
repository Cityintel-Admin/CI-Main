/* CityIntel Panic Access service worker — Phase 2 */
const CACHE_NAME = 'cityintel-panic-access-v2';
const SHELL = [
  '/panic-employee.html',
  '/panic-manifest.json',
  '/CityintLogo.jpg',
  '/favicon-512.png',
  '/favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(SHELL.map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) await cache.put(url, response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('cityintel-panic-access-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API traffic. A panic alarm must only report success after the
  // live Worker confirms receipt.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate' && url.pathname === '/panic-employee.html') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/panic-employee.html', fresh.clone());
        }
        return fresh;
      } catch (_) {
        return (await caches.match('/panic-employee.html')) || Response.error();
      }
    })());
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(url.pathname);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(url.pathname, fresh.clone());
      }
      return fresh;
    })());
  }
});
