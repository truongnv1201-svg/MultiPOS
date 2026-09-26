/* MultiPOS service worker (PWA offline-first, SRS §5 — Giai đoạn 3).
 * - Navigation: network-first; rớt mạng -> shell '/' đã cache -> /offline
 * - /_next/static: cache-first (hash URL bất biến nên an toàn)
 * - Tài nguyên tĩnh cùng origin (manifest, icon, offline): stale-while-revalidate
 * - Không cache request ngoài origin (Supabase REST/Realtime luôn đi mạng)
 *
 * Giai đoạn 3: cache shell '/' lúc install để POS mở được khi mất mạng
 * (trước đó chỉ cache /offline nên app rơi thẳng vào trang "Đang ngoại tuyến").
 */
const CACHE = 'multipos-v213-1';
const OFFLINE_URL = '/offline';
const SHELL_URL = '/';
const PRECACHE = [OFFLINE_URL, SHELL_URL, '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // addAll fail nếu 1 URL lỗi -> dùng allSettled để SW vẫn cài được
        Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
      )
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Làm mới shell đã cache khi có mạng (navigate tới bất kỳ route nào).
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match(SHELL_URL)) || (await caches.match(OFFLINE_URL)))
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Tài nguyên tĩnh cùng origin: stale-while-revalidate (icon, manifest, favicon...)
  if (/\.(?:svg|png|jpg|jpeg|webp|ico|webmanifest|json|css|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
  }
});
