import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPodcastRss,
  normalizePodcastChapters,
  normalizeTranscriptSegments,
  podcastSlug,
  publicPodcastEpisode,
  validateOnlinePodcastPublication
} from "../lib/podcast-core.mjs";

const instant = new Date("2026-09-06T12:00:00.000Z");
const series = { id: "series-1", organisationId: "org-1", product: "ONLINE_RADIO", stationId: "station-1", feedSlug: "morning-show", title: "Morning & News", description: "Daily <stories>", author: "Ruvanas" };
const mediaAsset = { id: "asset-1", organisationId: "org-1", status: "READY", sizeBytes: 12345n, mimeType: "audio/mpeg", durationSeconds: 125 };
const episode = { id: "episode-1", organisationId: "org-1", title: "Episode <One>", summary: "News & music", explicit: false, publishedAt: instant, mediaAsset, transcript: { status: "APPROVED", segmentsJson: [{ startMs: 0, endMs: 1000, text: "Hello" }] }, chaptersJson: [{ startMs: 0, title: "Start" }] };

test("podcast slugs and editor data are bounded and deterministic", () => {
  assert.equal(podcastSlug("  Café Morning Show!  "), "cafe-morning-show");
  assert.deepEqual(normalizePodcastChapters([{ startMs: 5000, title: "Second" }, { startMs: 0, title: "Opening" }]).map((item) => item.title), ["Opening", "Second"]);
  assert.equal(normalizeTranscriptSegments([{ startMs: 0, endMs: 1, text: "Hello" }])[0].text, "Hello");
  assert.throws(() => normalizePodcastChapters([{ title: "" }]), /needs a title/);
  assert.throws(() => normalizeTranscriptSegments([{ text: "" }]), /needs text/);
});

test("Online Radio publication fails closed on product, station, tenant, audio and transcript", () => {
  assert.equal(validateOnlinePodcastPublication({ series, episode, approvedAudio: mediaAsset, transcriptStatus: "APPROVED" }).status, "PUBLISHED");
  assert.throws(() => validateOnlinePodcastPublication({ series: { ...series, product: "SCHOOL_RADIO" }, episode, approvedAudio: mediaAsset }), /Online Radio/);
  assert.throws(() => validateOnlinePodcastPublication({ series: { ...series, stationId: null }, episode, approvedAudio: mediaAsset }), /station/);
  assert.throws(() => validateOnlinePodcastPublication({ series, episode, approvedAudio: { ...mediaAsset, organisationId: "other" } }), /active organisation/);
  assert.throws(() => validateOnlinePodcastPublication({ series, episode, approvedAudio: { ...mediaAsset, status: "PROCESSING" } }), /approved/);
  assert.throws(() => validateOnlinePodcastPublication({ series, episode, approvedAudio: mediaAsset, transcriptStatus: "DRAFT" }), /transcript/);
});

test("RSS is standards-shaped, absolute and XML escaped without leaking storage keys", () => {
  const rss = buildPodcastRss({ origin: "https://radio.example", organisationSlug: "ruvanas", series, episodes: [episode] });
  assert.match(rss, /<rss version="2\.0"/);
  assert.match(rss, /Morning &amp; News/);
  assert.match(rss, /Episode &lt;One&gt;/);
  assert.match(rss, /https:\/\/radio\.example\/api\/public\/podcasts\/ruvanas\/morning-show\/episodes\/episode-1\/audio/);
  assert.match(rss, /<itunes:duration>125<\/itunes:duration>/);
  assert.doesNotMatch(rss, /storageKey|organisations\/org-1/);
});

test("public episode output exposes approved content, never storage or tenant internals", () => {
  const safe = publicPodcastEpisode(episode, { organisationSlug: "ruvanas", feedSlug: "morning-show" });
  assert.equal(safe.title, episode.title);
  assert.equal(safe.transcript.length, 1);
  assert.match(safe.audioPath, /^\/api\/public\/podcasts\//);
  assert.equal("mediaAsset" in safe, false);
  assert.equal("organisationId" in safe, false);
});

test("Stage 19.16 shares podcast primitives, preserves school policy and protects routes", async () => {
  const [schema, migration, route, publicLoader, audioDelivery, schoolCore, schoolRoute, page, navigation] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261017000000_stage_19_16_shared_podcasts/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/podcasts/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-podcast.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/podcast-audio-delivery.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/school-podcast-live.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/podcasts/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/podcasts/PodcastWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);
  assert.match(schema, /enum PodcastProduct/);
  assert.match(schema, /product\s+PodcastProduct\s+@default\(SCHOOL_RADIO\)/);
  assert.match(schema, /@@unique\(\[organisationId, feedSlug\]\)/);
  assert.match(migration, /FOREIGN KEY \("stationId", "organisationId"\)/);
  assert.match(migration, /FOREIGN KEY \("mediaAssetId", "organisationId"\)/);
  assert.match(route, /requireActivePodcast\(ORGANISATION_CONTENT_ROLES\)/);
  assert.match(route, /managerRequired/);
  assert.match(route, /approvedForPromo/);
  assert.doesNotMatch(route, /data\.organisationId|body\.organisationId/);
  assert.match(publicLoader, /validateOnlinePodcastPublication/);
  assert.match(audioDelivery, /Accept-Ranges/);
  assert.match(schoolCore, /from "\.\/podcast-core\.mjs"/);
  assert.match(schoolRoute, /product: "SCHOOL_RADIO"/);
  assert.match(page, /RSS/);
  assert.match(navigation, /\/dashboard\/podcasts/);
});

test("RSS generation remains bounded for a full public feed", () => {
  const episodes = Array.from({ length: 200 }, (_, index) => ({ ...episode, id: `episode-${index}`, title: `Episode ${index}` }));
  const started = performance.now();
  const rss = buildPodcastRss({ origin: "https://radio.example", organisationSlug: "ruvanas", series, episodes });
  assert.match(rss, /Episode 199/);
  assert.ok(performance.now() - started < 500);
});
