import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGenreRotation, findPlaylistConflict, findPublishedProgrammeConflict, parsePlaylistEvent, parseSimplePlaylist } from "../lib/subscriber-playlists.mjs";
import { subscriberPlaylistCandidate } from "../lib/playout-source-adapters.mjs";
import { boundEncoderCache, eligibleScheduledOnlineRotation } from "../lib/online-radio-output.mjs";
import { rightsUseForChannel } from "../lib/subscriber-playlist-service.mjs";

const track = (id, genre, artist) => ({ track: { id, artist, status: "READY", permittedUses: ["ONLINE_RADIO"], minimumCatalogueLevel: "FOCUSED", permittedTerritories: "WORLDWIDE", mediaAsset: { id: `asset-${id}`, status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE", organisationId: null, licensedCatalogue: false, durationSeconds: 180, genres: [{ mediaGenre: { name: genre, slug: genre.toLowerCase() } }] } }, genreCodes: [genre.toUpperCase()] });
const entries = [track("pop1", "Pop", "A"), track("pop2", "Pop", "B"), track("rock1", "Rock", "C"), track("country1", "Country", "D")];

test("subscriber templates validate duration, genre pool and ordered duplicate slots", () => {
  const available = new Set(["POP", "ROCK", "COUNTRY"]);
  const pool = parseSimplePlaylist({ name: "Morning", durationValue: 3, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["Pop", "Rock"] }, available);
  assert.equal(pool.ok, true);
  assert.equal(pool.data.durationMinutes, 180);
  assert.deepEqual(pool.data.genreCodes, ["POP", "ROCK"]);
  assert.equal(parseSimplePlaylist({ name: "Morning", durationValue: 1, durationUnit: "DAYS", buildMode: "GENRE_SEQUENCE", genreCodes: ["Pop", "Pop", "Rock"] }, available).data.durationMinutes, 1440);
  assert.equal(parseSimplePlaylist({ name: "Morning", durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["Pop", "Pop"] }, available).ok, false);
  assert.equal(parseSimplePlaylist({ name: "Morning", durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["Unknown"] }, available).ok, false);
});

test("sequence repeats genre slots, chooses songs dynamically, and safely falls back from empty slots", () => {
  const sequence = buildGenreRotation({ entries, genreCodes: ["POP", "POP", "ROCK"], buildMode: "GENRE_SEQUENCE", durationMinutes: 20, seed: "morning" });
  assert.deepEqual(sequence.entries.slice(0, 6).map((item) => item.genreCodes[0]), ["POP", "POP", "ROCK", "POP", "POP", "ROCK"]);
  assert.notEqual(sequence.entries[0].track.id, sequence.entries[1].track.id);
  const fallback = buildGenreRotation({ entries, genreCodes: ["POP", "JAZZ"], buildMode: "GENRE_SEQUENCE", durationMinutes: 12, seed: "morning" });
  assert.equal(fallback.entries.length > 0, true);
  assert.match(fallback.warnings.join(" "), /No eligible JAZZ/);
  const pool = buildGenreRotation({ entries, genreCodes: ["POP", "ROCK"], durationMinutes: 20, seed: "pool" });
  assert.equal(pool.entries.every((item) => ["POP", "ROCK"].includes(item.genreCodes[0])), true);
});

test("schedule times use the channel timezone, reject invalid ranges, and detect overlap", () => {
  const input = { channelId: "cmu6gqnh7000jgk3c2jfpbroj", playlistId: "cmu6gqnh7000jgk3c2jfpbrok", timezone: "Europe/Malta", startsAt: "2026-09-25T01:00", endsAt: "2026-09-25T03:00" };
  const parsed = parsePlaylistEvent(input);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.endsAt - parsed.data.startsAt, 7200000);
  assert.equal(parsePlaylistEvent({ ...input, endsAt: "2026-09-25T00:30" }).ok, false);
  assert.equal(parsePlaylistEvent({ ...input, startsAt: "2026-03-29T02:30" }).ok, false);
  assert.equal(findPlaylistConflict([{ id: "one", startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt }], { startsAt: new Date(parsed.data.startsAt.getTime() + 60000), endsAt: new Date(parsed.data.endsAt.getTime() + 60000) }).id, "one");
  assert.equal(findPlaylistConflict([{ id: "one", startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt }], { startsAt: parsed.data.endsAt, endsAt: new Date(parsed.data.endsAt.getTime() + 60000) }), null);
});

test("published weekly programmes block subscriber schedule overlaps", () => {
  const version = { items: [{ id: "programme", position: 0, label: "Live show", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 5, startMinute: 180, durationMinutes: 60, priority: 80 }] };
  const overlapping = { startsAt: new Date("2026-09-25T00:30:00Z"), endsAt: new Date("2026-09-25T02:30:00Z") };
  assert.equal(findPublishedProgrammeConflict(version, overlapping, "Europe/Malta")?.label, "Live show");
  assert.equal(findPublishedProgrammeConflict(version, { startsAt: new Date("2026-09-25T02:00:00Z"), endsAt: new Date("2026-09-25T03:00:00Z") }, "Europe/Malta"), null);
});

test("rights profiles follow the pillar and unknown unlinked channels fail closed", () => {
  assert.equal(rightsUseForChannel({ musicRightsUse: "SCHOOL_RADIO" }), "SCHOOL_RADIO");
  assert.equal(rightsUseForChannel({ station: { productFamily: "FAITH" } }), "FAITH_RADIO");
  assert.equal(rightsUseForChannel({ stationId: null }), null);
});

test("scheduled template is tenant scoped and outranks Non-Stop but not explicit programmes", () => {
  const now = new Date("2026-09-25T01:30:00Z");
  const event = { id: "event", organisationId: "org-a", channelId: "channel-a", startsAt: new Date("2026-09-25T01:00:00Z"), endsAt: new Date("2026-09-25T03:00:00Z"), smartPlaylist: { id: "playlist", organisationId: "org-a", status: "ACTIVE", simpleBuildMode: "GENRE_SEQUENCE", durationMinutes: 180, genreCodes: ["POP", "ROCK"], rightsUse: "ONLINE_RADIO", version: 1, musicMode: { id: "mode", name: "Morning", status: "ACTIVE", tracks: entries.map((item) => ({ track: item.track, weight: 100 })) } } };
  assert.equal(subscriberPlaylistCandidate(event, { organisationId: "org-b", channelId: "channel-a", instant: now }), null);
  assert.equal(subscriberPlaylistCandidate(event, { organisationId: "org-a", channelId: "channel-b", instant: now }), null);
  const candidate = subscriberPlaylistCandidate(event, { organisationId: "org-a", channelId: "channel-a", instant: now, licensedCatalogueLevel: "FOCUSED" });
  assert.equal(candidate.available, true);
  assert.equal(candidate.priority > 400 && candidate.priority < 600, true);
  assert.equal(candidate.validUntil.toISOString(), "2026-09-25T03:00:00.000Z");
});

test("Online Radio scheduled output uses the existing configured source and never crosses tenants", () => {
  const now = new Date("2026-09-25T01:30:00Z");
  const station = { id: "station", organisationId: "org-a", productFamily: "ONLINE", streamConfig: { outboundAutoDjEnabled: true, providerKey: "CENTOVA_CAST", serverHost: "example.com", sourcePort: 8198, sourcePasswordEncrypted: "secret" }, channels: [{ id: "channel-a", organisationId: "org-a", status: "ACTIVE" }] };
  const event = { id: "event", organisationId: "org-a", channelId: "channel-a", startsAt: new Date("2026-09-25T01:00:00Z"), endsAt: new Date("2026-09-25T03:00:00Z"), smartPlaylist: { id: "playlist", organisationId: "org-a", status: "ACTIVE", rightsUse: "ONLINE_RADIO", simpleBuildMode: "RANDOM_GENRE_POOL", durationMinutes: 60, genreCodes: ["POP"], version: 1, updatedAt: now, musicModeId: "mode" } };
  assert.equal(eligibleScheduledOnlineRotation(station, { onlineRadioEnabled: true }, event, entries, now).ready, true);
  assert.equal(eligibleScheduledOnlineRotation(station, { onlineRadioEnabled: true }, { ...event, smartPlaylist: { ...event.smartPlaylist, organisationId: "org-b" } }, entries, now).ready, false);
  assert.equal(eligibleScheduledOnlineRotation({ ...station, streamConfig: null }, { onlineRadioEnabled: true }, event, entries, now).ready, false);
  assert.equal(boundEncoderCache([{ track: { mediaAsset: { sizeBytes: 100 } } }, { track: { mediaAsset: { sizeBytes: 200 } } }], 250).length, 1);
});

test("subscriber routes scope resources and station creation registers its channel", async () => {
  const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [playlistRoute, eventRoute, nonStopRoute, stationRoute, adminPage] = await Promise.all([
    source("../app/api/programming/simple/[playlistId]/route.js"), source("../app/api/programming/simple/events/route.js"), source("../app/api/programming/simple/nonstop/route.js"), source("../app/api/stations/route.js"), source("../app/admin/stations/page.js")
  ]);
  assert.match(playlistRoute, /id: playlistId, organisationId/);
  assert.match(eventRoute, /channelId: channel\.id, cancelledAt: null/);
  assert.match(nonStopRoute, /id: parsed\.data\.channelId, organisationId/);
  assert.match(stationRoute, /channels: \{ create:/);
  assert.match(adminPage, /Pending manual configuration/);
});
