// Keeps the phone page and its files on the phone, so that it opens with no connection (Fouad, 2026-11-13).
// It serves only /phone.html (its scope) and what that page loads. The server's answers (/api/…) are never kept.
const CACHE = 'magis-phone-v1';
const EXTRA = ['/phone.webmanifest', '/brand/magis-sun.png', '/brand/phone-180.png', '/brand/phone-192.png', '/brand/phone-512.png', '/fonts/amiri-arabic-400.woff2', '/fonts/amiri-arabic-700.woff2'];

// takes the page fresh from the server, with every file it names
async function refresh() {
  const res = await fetch('/phone.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('page');
  const html = await res.clone().text();
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const cache = await caches.open(CACHE);
  await cache.put('/phone.html', res);
  await Promise.all([...files, ...EXTRA].map(async (u) => {
    if (await cache.match(u)) return;
    const r = await fetch(u);
    if (r.ok) await cache.put(u, r);
  }));
}

self.addEventListener('install', (e) => { e.waitUntil(refresh().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/phone.html') {
    // the page: fresh when the server is there (and its new files with it), the kept one otherwise
    e.respondWith(refresh().then(() => caches.match('/phone.html')).catch(() => caches.match('/phone.html')).then((r) => r || fetch(e.request)));
    return;
  }
  // its files: the kept one first (their names change when they change)
  e.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && (url.pathname.startsWith('/assets/') || EXTRA.includes(url.pathname))) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
    return r;
  })));
});
