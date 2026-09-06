# Stage 19.18 — PWA and Mobile

## Outcome

Stage 19.18 makes each published Online Radio station website installable from supported mobile and desktop browsers. It provides a station-branded web-app manifest, conservative offline behaviour, connection and update guidance, and responsive public listening journeys without introducing a native application, a second player, or another listener identity.

Native App Store and Play Store packaging, review and publication remain external activities. This stage creates a production-ready Progressive Web App foundation that can later be wrapped or extended without changing the station, playout, podcast or listener-capacity models.

## Listener experience

- The public station website advertises a station-specific install manifest.
- Supported browsers offer a deliberate **Install** action; iPhone and iPad users receive clear Add to Home Screen guidance.
- The installed experience opens at the station website and offers shortcuts to live listening and the latest podcast family.
- A connection banner explains when the device is offline without presenting stale audio as live.
- The last successfully opened public station or podcast page can remain readable offline.
- Live playback, now-playing data, listener requests and account actions resume only after the network returns.
- A waiting service-worker update is presented as an explicit listener-controlled refresh.

## Cache and privacy boundary

The service worker has a deliberately narrow cache policy:

- only the offline shell, app icon, versioned framework assets, public station pages and public podcast pages may be stored;
- `/api/*`, live-listener manifests, analytics, requests, account pages, dashboards and administration pages are never cached;
- audio/video, byte-range requests and requests carrying authorization are never cached;
- no listener token, session identifier, credential, streaming URL or personal profile is written to offline storage;
- the existing Stage 19.14 anonymous listening lease remains authoritative, so installation never bypasses listener limits.

The only browser preference retained is the path of the last public station page, allowing a safe offline return link.

## Operational behaviour

Service-worker caches are release-versioned. Activation removes earlier Ruvanas PWA caches and claims open pages. Failed or unknown requests fall back to the offline page rather than inventing current programme or playback state. A future native wrapper must continue using the same protected public-player and telemetry contracts.

## Rollback

Remove PWA registration from public pages and release a new service-worker cache version that deletes the Stage 19.18 caches. Installed browser shortcuts may remain on listener devices until removed by the listener, but they safely reopen ordinary public routes. No database rollback is required, and Retail Radio, School Radio, enrolled players, listener leases and media remain unchanged.
