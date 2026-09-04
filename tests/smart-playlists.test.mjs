import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canAuthorSmartPlaylist,
  canPublishSmartPlaylist,
  describeSmartPlaylistRule,
  evaluateSmartPlaylistCandidates,
  parseSmartPlaylistInput,
  smartPlaylistRuleMatches,
  smartPlaylistSlug,
  smartPlaylistTrackQuery
} from "../lib/smart-playlists.mjs";

const baseInput = {
  name: "Clean modern pop",
  description: "Daytime station rotation",
  maxTracks: 250,
  defaultWeight: 100,
  sort: "RELEASE_YEAR_DESC",
  rightsUse: "ONLINE_RADIO",
  territory: "MT",
  rules: [
    { field: "GENRE", operator: "IS", value: "Pop" },
    { field: "EXPLICIT", operator: "IS", value: "false" },
    { field: "RELEASE_YEAR", operator: "AT_LEAST", value: "2020" }
  ]
};

function track(overrides = {}) {
  return {
    id: "track-1",
    title: "Morning Light",
    artist: "Example Artist",
    album: "Daytime",
    releaseYear: 2024,
    isExplicit: false,
    status: "READY",
    licenceStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    licenceExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    rightsHolder: "Example Rights",
    rightsReference: "LIC-42",
    rightsBasis: "DIRECT_LICENCE",
    permittedTerritories: "MT",
    permittedUses: ["ONLINE_RADIO"],
    rightsConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    rightsReviewStatus: "APPROVED",
    mediaAsset: {
      status: "READY",
      mediaType: "MUSIC",
      libraryType: "ORGANISATION_MUSIC",
      organisationId: "org-1",
      genres: [{ mediaGenre: { name: "Pop", slug: "pop" } }]
    },
    ...overrides
  };
}

test("Smart Playlist roles separate authoring from publication", () => {
  assert.equal(canAuthorSmartPlaylist("CONTENT_EDITOR"), true);
  assert.equal(canPublishSmartPlaylist("CONTENT_EDITOR"), false);
  assert.equal(canPublishSmartPlaylist("OWNER"), true);
  assert.equal(canPublishSmartPlaylist("MANAGER"), true);
  assert.equal(canAuthorSmartPlaylist("VIEWER"), false);
});

test("Smart Playlist input normalises valid rules and rejects incompatible or duplicated rules", () => {
  const parsed = parseSmartPlaylistInput(baseInput);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.rules[2].value, "2020");
  assert.equal(smartPlaylistSlug("Café & Clean Pop"), "cafe-clean-pop");

  const incompatible = parseSmartPlaylistInput({ ...baseInput, rules: [{ field: "EXPLICIT", operator: "CONTAINS", value: "false" }] });
  assert.equal(incompatible.ok, false);
  assert.match(incompatible.error, /comparison/i);

  const duplicate = parseSmartPlaylistInput({ ...baseInput, rules: [baseInput.rules[0], baseInput.rules[0]] });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /duplicated/i);
});

test("rules are explainable and match track metadata deterministically", () => {
  const candidate = track();
  for (const rule of baseInput.rules) assert.equal(smartPlaylistRuleMatches(candidate, rule), true);
  assert.equal(smartPlaylistRuleMatches(candidate, { field: "ARTIST", operator: "CONTAINS", value: "example" }), true);
  assert.equal(smartPlaylistRuleMatches(candidate, { field: "GENRE", operator: "IS_NOT", value: "Rock" }), true);
  assert.equal(describeSmartPlaylistRule(baseInput.rules[2]), "Release year is at least 2020");
});

test("materialisation candidates stay tenant and rights scoped", () => {
  const playlist = { organisationId: "org-1", maxTracks: 10, rightsUse: "ONLINE_RADIO", territory: "MT", rules: baseInput.rules };
  const accepted = evaluateSmartPlaylistCandidates([track()], playlist, new Date("2026-09-04T12:00:00.000Z"));
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].explanations.length, 3);

  const wrongTenant = track({ mediaAsset: { ...track().mediaAsset, organisationId: "org-2" } });
  assert.equal(evaluateSmartPlaylistCandidates([wrongTenant], playlist, new Date("2026-09-04T12:00:00.000Z")).length, 0);
  const rejectedRights = track({ rightsReviewStatus: "REJECTED" });
  assert.equal(evaluateSmartPlaylistCandidates([rejectedRights], playlist, new Date("2026-09-04T12:00:00.000Z")).length, 0);
});

test("database queries are bounded, deterministic and tenant constrained", () => {
  const query = smartPlaylistTrackQuery({ organisationId: "org-1", maxTracks: 5000, sort: "ARTIST_TITLE", rules: baseInput.rules });
  assert.equal(query.take, 1000);
  assert.deepEqual(query.orderBy[0], { artist: "asc" });
  assert.equal(query.where.mediaAsset.OR[1].organisationId, "org-1");
  assert.equal(query.where.AND.length, 3);
});

test("Stage 19.3 keeps schema, routes, UI and existing rotation reuse explicit", async () => {
  const [schema, migration, route, publishRoute, service, page, component] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261005000000_stage_19_3_smart_playlists/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/smart-playlists/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/smart-playlists/[smartPlaylistId]/publish/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/smart-playlist-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/SmartPlaylistsWorkspace.js", import.meta.url), "utf8")
  ]);
  assert.match(schema, /model SmartPlaylist/);
  assert.match(schema, /source\s+MusicModeSource\s+@default\(MANUAL\)/);
  assert.match(migration, /FOREIGN KEY \("musicModeId", "organisationId"\)/);
  assert.match(route, /organisationId = membership\.organisationId/);
  assert.doesNotMatch(route, /data\.organisationId/);
  assert.match(publishRoute, /canPublishSmartPlaylist\(context\.membership\.role\)/);
  assert.match(service, /musicModeTrack\.createMany/);
  assert.match(service, /EMPTY_SMART_PLAYLIST/);
  assert.match(page, /SmartPlaylistsWorkspace/);
  assert.match(component, /EXPLAINABLE PREVIEW/);
});
