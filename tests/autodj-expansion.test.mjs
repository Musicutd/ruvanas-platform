import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertGenreSelection, licensedGenresForLevel, normaliseGenreCode } from "../lib/autodj-genre-entitlements.mjs";
import { generateTimedPlaylist, invalidationForCatalogueDowngrade, parseTimedPlaylistInput } from "../lib/timed-playlist-generator.mjs";
import { resolveUnifiedPlayout, PLAYOUT_SOURCE_PRIORITIES } from "../lib/playout-resolver.mjs";

const codes = (level, extra = []) => licensedGenresForLevel(level, extra).map((genre) => genre.code);

test("Licensed Music Catalogue tiers expose the exact fixed genre matrix", () => {
  assert.deepEqual(codes("NONE"), []);
  assert.deepEqual(codes("FOCUSED"), ["POP", "HIP_HOP", "DANCE", "ROCK"]);
  assert.deepEqual(codes("PROFESSIONAL"), ["POP", "HIP_HOP", "DANCE", "ROCK", "COUNTRY", "LATIN", "CARIBBEAN", "CHRISTIAN"]);
  assert.deepEqual(codes("PREMIUM"), ["POP", "HIP_HOP", "DANCE", "ROCK", "COUNTRY", "LATIN", "CARIBBEAN", "CHRISTIAN", "CLUB_HOUSE_EXTENDED"]);
});

test("Premium more is administrator-configured and aliases share one taxonomy", () => {
  assert.equal(normaliseGenreCode("Hip Hop"), "HIP_HOP");
  assert.equal(normaliseGenreCode("House/Club"), "CLUB_HOUSE_EXTENDED");
  assert.deepEqual(codes("PREMIUM", [{ name: "Jazz", slug: "jazz", active: true, minimumCatalogueLevel: "PREMIUM" }]).slice(-1), ["JAZZ"]);
  assert.ok(!codes("PROFESSIONAL", [{ name: "Jazz", slug: "jazz", active: true, minimumCatalogueLevel: "PREMIUM" }]).includes("JAZZ"));
});

test("forged locked genres are rejected while subscriber-owned sources remain tier independent", () => {
  assert.throws(() => assertGenreSelection({ selectedGenreCodes: ["COUNTRY"], sourceScopes: ["LICENSED_CATALOGUE"], catalogueLevel: "FOCUSED" }), /current plan/i);
  assert.deepEqual(assertGenreSelection({ selectedGenreCodes: ["Country"], sourceScopes: ["SUBSCRIBER_LIBRARY"], catalogueLevel: "NONE" }).selectedGenreCodes, ["COUNTRY"]);
});

function track(index, overrides = {}) {
  const libraryType = overrides.libraryType || "ORGANISATION_MUSIC";
  const licensedCatalogue = overrides.licensedCatalogue === true;
  return {
    id: `track-${index}`, title: `Title ${index}`, artist: `Artist ${index % 5}`, status: "READY", isExplicit: false,
    rightsHolder: "Owner", rightsReference: `RIGHT-${index}`, rightsBasis: "DIRECT_LICENCE", permittedTerritories: "MT", permittedUses: ["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO"], rightsConfirmedAt: new Date("2026-01-01"), rightsReviewStatus: "APPROVED",
    mediaAsset: { status: "READY", mediaType: "MUSIC", libraryType, organisationId: libraryType === "ORGANISATION_MUSIC" ? "org-1" : null, licensedCatalogue, durationSeconds: 240 + (index % 3) * 15, genres: [{ mediaGenre: { name: index % 2 ? "Dance" : "Pop", slug: index % 2 ? "dance" : "pop" } }] },
    ...overrides
  };
}

const config = { organisationId: "org-1", startMinute: 600, endMinute: 840, selectedGenreCodes: ["POP", "DANCE"], sourceScopes: ["SUBSCRIBER_LIBRARY"], catalogueLevel: "NONE", rightsUse: "RETAIL_RADIO", territory: "MT" };

test("10:00-14:00 generation is finite, deterministic, balanced and close to the requested window", () => {
  const tracks = Array.from({ length: 30 }, (_, index) => track(index));
  const first = generateTimedPlaylist({ tracks, config, seed: "acceptance-seed", instant: new Date("2026-09-11") });
  const second = generateTimedPlaylist({ tracks, config, seed: "acceptance-seed", instant: new Date("2026-09-11") });
  assert.equal(first.requestedDurationSeconds, 14400);
  assert.ok(first.items.length > 30 && first.items.length < 100);
  assert.ok(Math.abs(first.varianceSeconds) <= 180);
  assert.deepEqual(first.items.map((item) => item.trackId), second.items.map((item) => item.trackId));
  assert.ok(first.items.every((item, index) => index === 0 || item.trackId !== first.items[index - 1].trackId));
  assert.ok(first.genreDistribution.POP > 0 && first.genreDistribution.DANCE > 0);
});

test("generation applies rights, territory and School safeguarding filters", () => {
  const deniedTerritory = track(90, { permittedTerritories: "US" });
  const explicit = track(91, { isExplicit: true });
  const school = generateTimedPlaylist({ tracks: [deniedTerritory, explicit, track(92)], config: { ...config, rightsUse: "SCHOOL_RADIO" }, seed: "school", instant: new Date("2026-09-11") });
  assert.ok(school.items.length > 0);
  assert.ok(school.items.every((item) => item.trackId === "track-92"));
});

test("licensed candidates require both plan genre entitlement and product use", () => {
  const licensed = track(100, { libraryType: "RUVANAS_CATALOGUE", licensedCatalogue: true });
  const allowed = generateTimedPlaylist({ tracks: [licensed, track(101, { libraryType: "RUVANAS_CATALOGUE", licensedCatalogue: true })], config: { ...config, sourceScopes: ["LICENSED_CATALOGUE"], catalogueLevel: "FOCUSED" }, seed: "licensed", instant: new Date("2026-09-11") });
  assert.ok(allowed.items.length > 0);
  const denied = generateTimedPlaylist({ tracks: [licensed], config: { ...config, sourceScopes: ["LICENSED_CATALOGUE"], catalogueLevel: "NONE" }, seed: "denied", instant: new Date("2026-09-11") });
  assert.equal(denied.items.length, 0);
});

test("a plan downgrade marks future licensed drafts for attention", () => {
  const reason = invalidationForCatalogueDowngrade({ status: "PUBLISHED", sourceScopes: ["LICENSED_CATALOGUE"], selectedGenreCodes: ["COUNTRY"] }, "FOCUSED");
  assert.match(reason, /COUNTRY/);
  assert.equal(invalidationForCatalogueDowngrade({ status: "PUBLISHED", sourceScopes: ["SUBSCRIBER_LIBRARY"], selectedGenreCodes: ["COUNTRY"] }, "NONE"), null);
});

test("target-local input is bounded and Online Radio does not need a location", () => {
  assert.equal(parseTimedPlaylistInput({ name: "Web block", targetType: "CHANNEL", targetId: "channel-1", scheduledDate: "2026-09-12", startTime: "10:00", endTime: "14:00", selectedGenreCodes: ["POP"], sourceScopes: ["SUBSCRIBER_LIBRARY"] }, { timezone: "UTC", rightsUse: "ONLINE_RADIO" }).ok, true);
  assert.equal(parseTimedPlaylistInput({ name: "Too long", targetType: "CHANNEL", targetId: "channel-1", scheduledDate: "2026-09-12", startTime: "00:00", endTime: "23:59", selectedGenreCodes: ["POP"], sourceScopes: ["SUBSCRIBER_LIBRARY"] }, { timezone: "UTC", rightsUse: "ONLINE_RADIO" }).ok, false);
});

test("unified playout keeps overrides authoritative and AutoDJ resumes without avoidable dead air", () => {
  const instant = new Date("2026-09-11T10:00:00Z");
  const window = { validFrom: new Date(instant - 1000), validUntil: new Date(instant.getTime() + 3600000) };
  const result = resolveUnifiedPlayout({ organisationId: "org-1", channelId: "channel-1", targetId: "player-1", instant, candidates: [
    { ...window, sourceType: "LIVE_SESSION", sourceId: "live", priority: PLAYOUT_SOURCE_PRIORITIES.LIVE_SESSION, available: false },
    { ...window, sourceType: "DEFAULT_AUTODJ", sourceId: "autodj", priority: PLAYOUT_SOURCE_PRIORITIES.DEFAULT_AUTODJ, available: true, proofClassification: "AUTODJ" }
  ] });
  assert.equal(result.sourceType, "DEFAULT_AUTODJ");
  assert.equal(result.operatorAlert.code, "PLAYOUT_FALLBACK_ACTIVE");
});

test("routes derive tenant and plan server-side and preserve frozen version records", async () => {
  const [route, publish, schema, migration, player] = await Promise.all([
    readFile(new URL("../app/api/programming/autodj-expansion/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/autodj-expansion/[playlistId]/publish/route.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261109000000_autodj_expansion/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /membership\.organisationId/); assert.doesNotMatch(route, /body\?\.organisationId/);
  assert.match(route, /licensedMusicCatalogueLevel/); assert.match(publish, /assertGenreSelection/);
  assert.match(schema, /model GeneratedPlaylistVersion/); assert.match(schema, /model GeneratedPlaylistItem/);
  assert.match(migration, /GeneratedPlaylistItem_timing_check/); assert.match(player, /licensedCatalogueLevel/);
});
