import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generalGeneratedPlaylistIds, listGeneralGeneratedPlaylistIds } from "../lib/general-generated-playlist-boundary.mjs";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("general AutoDJ omits private targets and refuses private policy edits, even on disable", async () => {
  const [targets, route] = await Promise.all([
    source("lib/autodj-targets.js"),
    source("app/api/programming/autodj/route.js")
  ]);
  assert.match(targets, /correctionsFacility: \{ is: null \}/);
  assert.match(targets, /channelAssignments: \{ where: \{[^\n]*channel: \{ is: GENERAL_STUDIO_CHANNEL_WHERE \}/);
  assert.match(targets, /where: \{ organisationId, status: "ACTIVE", \.\.\.GENERAL_STUDIO_CHANNEL_WHERE \}/);
  assert.match(route, /const channel = await prisma\.channel\.findFirst\([\s\S]*?\.\.\.GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(route, /previous\?\.rightsUse === "CORRECTIONS_RADIO"/);
  assert.match(route, /await assertCorrectionsSchedulingAllowed\(tx, \{[\s\S]*?channelId: channel\.id/);
  assert.match(route, /previous\?\.targetType === "LOCATION" \|\| previous\?\.targetType === "ZONE"/);
});

test("advanced Smart Playlist reads and mutations exclude historical private playlists", async () => {
  const [route, updateRoute, service] = await Promise.all([
    source("app/api/programming/smart-playlists/route.js"),
    source("app/api/programming/smart-playlists/[smartPlaylistId]/route.js"),
    source("lib/smart-playlist-service.js")
  ]);
  assert.match(route, /listSmartPlaylists\(membership\.organisationId\)/);
  assert.match(updateRoute, /simpleBuildMode: null, \.\.\.GENERAL_SIMPLE_PLAYLIST_WHERE/);
  assert.equal((service.match(/\.\.\.GENERAL_SIMPLE_PLAYLIST_WHERE/g) || []).length, 3,
    "list, preview/publish lookup, and archive lookup must all filter private playlists");
  assert.match(service, /where: \{ organisationId, simpleBuildMode: null, status: \{ not: "ARCHIVED" \}, \.\.\.GENERAL_SIMPLE_PLAYLIST_WHERE \}/);
  assert.match(service, /async function playlistForEvaluation/);
  assert.match(service, /export async function archiveSmartPlaylist/);
});

test("historical timed playlists are limited to ordinary same-organisation targets", async () => {
  const calls = {};
  const database = {
    location: { findMany: async ({ where }) => {
      calls.location = where;
      return [{ id: "shop" }];
    } },
    zone: { findMany: async ({ where }) => {
      calls.zone = where;
      return [{ id: "shop-floor" }];
    } },
    channel: { findMany: async ({ where }) => {
      calls.channel = where;
      return [{ id: "public-channel" }];
    } }
  };
  const playlists = [
    { id: "shop-playlist", targetType: "LOCATION", targetId: "shop", rightsUse: "RETAIL_RADIO" },
    { id: "facility-playlist", targetType: "LOCATION", targetId: "facility", rightsUse: "RETAIL_RADIO" },
    { id: "zone-playlist", targetType: "ZONE", targetId: "shop-floor", rightsUse: "RETAIL_RADIO" },
    { id: "private-zone-playlist", targetType: "ZONE", targetId: "private-wing", rightsUse: "RETAIL_RADIO" },
    { id: "channel-playlist", targetType: "CHANNEL", targetId: "public-channel", rightsUse: "ONLINE_RADIO" },
    { id: "private-channel-playlist", targetType: "CHANNEL", targetId: "inside-channel", rightsUse: "ONLINE_RADIO" },
    { id: "private-rights-playlist", targetType: "CHANNEL", targetId: "public-channel", rightsUse: "CORRECTIONS_RADIO" },
    { id: "unsupported-target-playlist", targetType: "UNKNOWN", targetId: "public-channel", rightsUse: "ONLINE_RADIO" }
  ];
  const allowed = await generalGeneratedPlaylistIds(database, "org-a", playlists);
  assert.deepEqual([...allowed], ["shop-playlist", "zone-playlist", "channel-playlist"]);
  assert.equal(calls.location.organisationId, "org-a");
  assert.deepEqual(calls.location.correctionsFacility, { is: null });
  assert.equal(calls.zone.location.organisationId, "org-a");
  assert.deepEqual(calls.zone.location.correctionsFacility, { is: null });
  assert.equal(calls.channel.organisationId, "org-a");
  assert.ok(calls.channel.AND, "channel target lookup must apply the shared private channel boundary");
});

test("timed playlist list and ID actions apply the historical target boundary", async () => {
  const [route, regenerateRoute, publishRoute, service] = await Promise.all([
    source("app/api/programming/autodj-expansion/route.js"),
    source("app/api/programming/autodj-expansion/[playlistId]/route.js"),
    source("app/api/programming/autodj-expansion/[playlistId]/publish/route.js"),
    source("lib/generated-playlist-service.js")
  ]);
  assert.match(route, /listGeneralGeneratedPlaylistIds\(prisma, membership\.organisationId\)/);
  assert.match(route, /rightsUse: \{ not: "CORRECTIONS_RADIO" \}/);
  assert.match(route, /const generalPlaylists = playlists\.filter\(\(playlist\) => stillAllowedIds\.has\(playlist\.id\)\)/);
  assert.match(route, /for \(const playlist of generalPlaylists\)/);
  assert.match(regenerateRoute, /regenerateGeneratedDraft/);
  assert.match(publishRoute, /generalGeneratedPlaylistIds\(prisma, access\.context\.membership\.organisationId, \[current\]\)/);
  assert.equal((service.match(/generalGeneratedPlaylistIds\(prisma, organisationId, \[(existing|current)\]\)/g) || []).length, 2,
    "regenerate and publish must each recheck the historical target");
});

test("private timed drafts cannot starve ordinary playlists beyond the first result page", async () => {
  const historical = Array.from({ length: 220 }, (_, index) => ({
    id: `private-${index}`, targetType: "LOCATION", targetId: `facility-${index}`, rightsUse: "RETAIL_RADIO"
  }));
  const rows = [...historical, { id: "public-a", targetType: "LOCATION", targetId: "shop-a", rightsUse: "RETAIL_RADIO" },
    { id: "public-b", targetType: "LOCATION", targetId: "shop-b", rightsUse: "RETAIL_RADIO" }];
  const pageCalls = [];
  const database = {
    generatedPlaylist: { findMany: async (query) => {
      pageCalls.push(query);
      const start = query.cursor ? rows.findIndex((row) => row.id === query.cursor.id) + query.skip : 0;
      return rows.slice(start, start + query.take);
    } },
    location: { findMany: async ({ where }) => where.id.in.filter((id) => id.startsWith("shop-")).map((id) => ({ id })) },
    zone: { findMany: async () => [] },
    channel: { findMany: async () => [] }
  };
  const visible = await listGeneralGeneratedPlaylistIds(database, "org-a", { limit: 100, pageSize: 100 });
  assert.deepEqual(visible, ["public-a", "public-b"]);
  assert.equal(pageCalls.length, 3);
  assert.deepEqual(pageCalls[1].cursor, { id: "private-99" });
  assert.deepEqual(pageCalls[2].cursor, { id: "private-199" });
  assert.equal(pageCalls[0].select.targetId, true, "paging should load target metadata, not full playlist versions");
});
