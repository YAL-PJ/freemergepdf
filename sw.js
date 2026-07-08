// Bump CACHE_VERSION whenever any app-shell asset changes, or returning
// visitors will keep getting the previously cached copy.
const CACHE_VERSION = 'freemergepdf-v2';
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/index-page.css',
  '/advanced-pdf-merger.css',
  '/feedback.css',
  '/error-reporting.js',
  '/advanced-pdf-merger.js',
  '/index-page.js',
  '/feedback.js',
  '/page-merge-ui.js',
  '/pdf.worker.min.js',
  '/site.webmanifest',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/og-image.png'
];

const CDN_CACHE_HOSTS = new Set([
  'cdnjs.cloudflare.com'
]);

// Assets the app cannot run without; a failed fetch for one of these fails
// the install so we never activate with a broken shell. Everything else
// (icons, social images) is cached best-effort.
const REQUIRED_SHELL_URLS = new Set([
  '/',
  '/index.html',
  '/index-page.css',
  '/index-page.js',
  '/advanced-pdf-merger.js',
  '/pdf.worker.min.js'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    const results = await Promise.allSettled(APP_SHELL_URLS.map(async (url) => {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`Precache failed: ${url} (${response.status})`);
      await cache.put(url, response);
      return url;
    }));
    const failedRequired = APP_SHELL_URLS.filter((url, i) => (
      results[i].status === 'rejected' && REQUIRED_SHELL_URLS.has(url)
    ));
    if (failedRequired.length > 0) {
      throw new Error(`Precache failed for required assets: ${failedRequired.join(', ')}`);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const expectedCaches = new Set([APP_SHELL_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.map((name) => (
      expectedCaches.has(name) ? Promise.resolve() : caches.delete(name)
    )));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    return;
  }

  if (CDN_CACHE_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    return (await cache.match(request))
      || (await cache.match('/index.html'))
      || cache.match('/');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  // Exact match only: the site cache-busts with ?v=N query strings, so an
  // ignoreSearch hit here would pin users to stale code after a deploy.
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(async () => (
      // Offline fallback: precached entries are stored without query
      // strings, so ignore the ?v= suffix only when the network is down.
      cached || (await cache.match(request, { ignoreSearch: true })) || Response.error()
    ));

  return cached || networkPromise;
}
