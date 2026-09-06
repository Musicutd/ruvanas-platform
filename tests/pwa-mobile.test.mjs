import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildStationWebManifest, publicOfflineCachePath } from "../lib/pwa-mobile.mjs";

const website = {
  name: "Malta Live Radio",
  slug: "malta-live",
  tagline: "Music and stories from Malta.",
  accent: "#f4b942",
  theme: "MIDNIGHT",
  playerEnabled: true,
  podcasts: [{ url: "/podcasts/org/daily" }]
};

test("station manifests are installable, branded and bounded to public routes", () => {
  const manifest = buildStationWebManifest(website);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/radio/malta-live?source=pwa");
  assert.equal(manifest.theme_color, "#f4b942");
  assert.equal(manifest.icons.some((icon) => icon.purpose === "maskable"), true);
  assert.deepEqual(manifest.shortcuts.map((item) => item.url), ["/listen/malta-live", "/podcasts/org/daily"]);
  assert.doesNotMatch(JSON.stringify(manifest), /organisationId|listenerToken|streamUrl|providerAccount/);
});

test("offline caching is restricted to anonymous station and podcast pages", () => {
  assert.equal(publicOfflineCachePath("/radio/malta-live?source=pwa"), "/radio/malta-live");
  assert.equal(publicOfflineCachePath("/podcasts/org/daily"), "/podcasts/org/daily");
  assert.equal(publicOfflineCachePath("/dashboard"), null);
  assert.equal(publicOfflineCachePath("/api/public/player/station/manifest"), null);
  assert.equal(publicOfflineCachePath("/listen/station"), null);
});

test("Stage 19.18 never caches credentials, APIs or protected audio", async () => {
  const [worker, lifecycle, manifestRoute, stationPage, playerPage, podcastPage, offlinePage, icon] = await Promise.all([
    readFile(new URL("../public/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PwaLifecycle.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/station-websites/[slug]/manifest/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/radio/[slug]/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/listen/[slug]/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/podcasts/[organisationSlug]/[feedSlug]/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/offline/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/icons/ruvanas-app.svg", import.meta.url), "utf8")
  ]);
  assert.match(worker, /request\.headers\.has\("authorization"\)/);
  assert.match(worker, /request\.headers\.has\("range"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /\["audio", "video"\]/);
  assert.doesNotMatch(worker, /\/dashboard|\/admin|localStorage|sessionStorage/);
  assert.match(lifecycle, /beforeinstallprompt/);
  assert.match(lifecycle, /controllerchange/);
  assert.match(manifestRoute, /application\/manifest\+json/);
  assert.match(stationPage + playerPage + podcastPage, /PwaLifecycle/);
  assert.match(playerPage, /stationWebsiteEnabled \? <PwaLifecycle/);
  assert.match(podcastPage, /station\.stationWebsiteEnabled \? <PwaLifecycle/);
  assert.match(offlinePage, /No private account information or audio is stored/);
  assert.match(icon, /viewBox="0 0 512 512"/);
});

test("public offline cache classification remains fast at mobile-navigation scale", () => {
  const started = performance.now();
  for (let index = 0; index < 25_000; index += 1) assert.equal(publicOfflineCachePath(`/radio/station-${index}?v=1`), `/radio/station-${index}`);
  assert.ok(performance.now() - started < 1_500);
});
