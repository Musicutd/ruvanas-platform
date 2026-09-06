const CACHE_VERSION = "stage-19-18-v1";
const SHELL_CACHE = `ruvanas-pwa-shell-${CACHE_VERSION}`;
const PAGE_CACHE = `ruvanas-pwa-pages-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const APP_ICON = "/icons/ruvanas-app.svg";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL, APP_ICON])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("ruvanas-pwa-") && ![SHELL_CACHE, PAGE_CACHE].includes(key)).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

function publicPage(pathname) {
  return /^\/(radio|podcasts)\/[^/]+/.test(pathname);
}

function pageCacheKey(url) {
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization") || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || ["audio", "video"].includes(request.destination)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok && publicPage(url.pathname) && (response.headers.get("content-type") || "").includes("text/html")) {
        const cache = await caches.open(PAGE_CACHE);
        await cache.put(pageCacheKey(url), response.clone());
      }
      return response;
    }).catch(async () => {
      if (publicPage(url.pathname)) {
        const cached = await caches.match(pageCacheKey(url));
        if (cached) return cached;
      }
      return caches.match(OFFLINE_URL);
    }));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
      if (response.ok) await (await caches.open(SHELL_CACHE)).put(request, response.clone());
      return response;
    })));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
