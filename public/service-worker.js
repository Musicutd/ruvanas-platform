// Purge earlier station and podcast page snapshots. A previously public
// podcast may later use a private Corrections station or supervised audio.
const CACHE_VERSION = "stage-19-18-v3";
const SHELL_CACHE = `ruvanas-pwa-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const APP_ICON = "/icons/ruvanas-app.svg";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL, APP_ICON])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("ruvanas-pwa-") && key !== SHELL_CACHE).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization") || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || ["audio", "video"].includes(request.destination)) return;

  if (request.mode === "navigate") {
    // HTML is never persisted: revocation/reclassification must not leave
    // a readable offline copy of private station or podcast metadata.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
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
