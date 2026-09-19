import assert from "node:assert/strict";
import test from "node:test";
import { planPublishedTimedChannelSequence } from "../lib/studio-timed-sequence-plan.mjs";
import { loadPublishedTimedChannelSequence } from "../lib/studio-timed-sequence-loader.mjs";

const now = new Date("2026-09-19T12:00:00Z");
const startsAt = new Date("2026-10-02T10:00:00Z");
const track = (id, duration) => ({
  id, status: "READY", isExplicit: false, rightsReviewStatus: "APPROVED",
  rightsConfirmedAt: new Date("2026-01-01T00:00:00Z"), rightsHolder: "Test owner",
  rightsReference: `TEST-${id}`, rightsBasis: "DIRECT_LICENCE",
  permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
  mediaAsset: {
    id: `asset-${id}`, status: "READY", mediaType: "MUSIC", libraryType: "ORGANISATION_MUSIC",
    organisationId: "org-1", licensedCatalogue: false, durationSeconds: duration,
    storageKey: `tests/${id}.mp3`, genres: [{ mediaGenre: { name: "Pop", slug: "pop" } }]
  }
});

function fixture() {
  const first = track("a", 240);
  const second = track("b", 255);
  const items = [
    { position: 0, trackId: "a", track: first, startOffsetSeconds: 0, endOffsetSeconds: 240, durationSeconds: 240, genreCode: "POP", sourceScope: "SUBSCRIBER_LIBRARY" },
    { position: 1, trackId: "b", track: second, startOffsetSeconds: 238, endOffsetSeconds: 493, durationSeconds: 255, genreCode: "POP", sourceScope: "SUBSCRIBER_LIBRARY" },
    { position: 2, trackId: "a", track: first, startOffsetSeconds: 491, endOffsetSeconds: 731, durationSeconds: 240, genreCode: "POP", sourceScope: "SUBSCRIBER_LIBRARY" }
  ];
  return {
    organisationId: "org-1", channelId: "channel-1", catalogueLevel: "NONE", instant: now,
    channel: { id: "channel-1", organisationId: "org-1", stationId: "station-1", status: "ACTIVE",
      station: { id: "station-1", organisationId: "org-1", productFamily: "ONLINE" } },
    playlist: {
      id: "playlist-1", organisationId: "org-1", targetType: "CHANNEL", targetId: "channel-1",
      name: "Test hour", status: "DRAFT", musicModeId: "mode-v2", currentVersion: 3,
      publishedVersion: 2, scheduledDate: new Date("2026-10-02T00:00:00Z"), timezone: "UTC",
      startMinute: 600, endMinute: 612, rightsUse: "ONLINE_RADIO", territory: "MT",
      selectedGenreCodes: ["POP"], sourceScopes: ["SUBSCRIBER_LIBRARY"],
      versions: [
        { version: 3, publishedAt: null, items: [items[1]] },
        { version: 2, publishedAt: now, requestedDurationSeconds: 720, generatedDurationSeconds: 731, items }
      ]
    },
    schedule: {
      id: "schedule-1", organisationId: "org-1", channelId: "channel-1", timezone: "UTC",
      versions: [{ id: "schedule-version-1", version: 1, status: "PUBLISHED", isActive: true, items: [{
        id: "programme-1", sourceType: "MUSIC_MODE", recurrence: "ONE_OFF", musicModeId: "mode-v2",
        label: "Test hour", priority: 50, durationMinutes: 12, startsAt
      }] }]
    }
  };
}

test("the dry-run plan preserves the published A-B-A order, overlap and private asset references", () => {
  const result = planPublishedTimedChannelSequence(fixture());
  assert.equal(result.ready, true);
  assert.equal(result.reason, "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR");
  assert.equal(result.version, 2);
  assert.equal(result.scheduleId, "schedule-1");
  assert.equal(result.scheduleVersion, 1);
  assert.equal(result.programmeItemId, "programme-1");
  assert.deepEqual(result.items.map((item) => item.trackId), ["a", "b", "a"]);
  assert.deepEqual(result.items.map((item) => item.startOffsetSeconds), [0, 238, 491]);
  assert.deepEqual(result.items.map((item) => item.storageKey), ["tests/a.mp3", "tests/b.mp3", "tests/a.mp3"]);
  assert.equal(result.listenerVerified, false);
  assert.equal(result.commandIssued, false);
});

test("a cross-tenant, unpublished, invalidated or mismatched channel plan fails closed", () => {
  const otherTenant = fixture(); otherTenant.playlist.organisationId = "org-2";
  assert.equal(planPublishedTimedChannelSequence(otherTenant).reason, "SEQUENCE_NOT_PUBLISHED_FOR_CHANNEL");
  const unpublished = fixture(); unpublished.playlist.publishedVersion = 0;
  assert.equal(planPublishedTimedChannelSequence(unpublished).reason, "SEQUENCE_NOT_PUBLISHED_FOR_CHANNEL");
  const malformedVersions = fixture(); malformedVersions.playlist.versions = {};
  assert.equal(planPublishedTimedChannelSequence(malformedVersions).reason, "SEQUENCE_VERSION_MISSING");
  const invalidated = fixture(); invalidated.playlist.status = "INVALIDATED";
  assert.equal(planPublishedTimedChannelSequence(invalidated).reason, "SEQUENCE_NOT_PUBLISHED_FOR_CHANNEL");
  const wrongChannel = fixture(); wrongChannel.channel.stationId = null;
  assert.equal(planPublishedTimedChannelSequence(wrongChannel).reason, "SEQUENCE_SCOPE_INVALID");
  const wrongProduct = fixture(); wrongProduct.channel.station.productFamily = "RETAIL";
  assert.equal(planPublishedTimedChannelSequence(wrongProduct).reason, "SEQUENCE_SCOPE_INVALID");
  const wrongBlock = fixture(); wrongBlock.schedule.versions[0].items[0].musicModeId = "other-mode";
  assert.equal(planPublishedTimedChannelSequence(wrongBlock).reason, "SEQUENCE_PROGRAMME_MISMATCH");
  const competingBlock = fixture(); competingBlock.schedule.versions[0].items.push({ ...competingBlock.schedule.versions[0].items[0] });
  assert.equal(planPublishedTimedChannelSequence(competingBlock).reason, "SEQUENCE_PROGRAMME_ARBITRATION_NOT_READY");
});

test("the dry-run rejects altered order, overlap, duration or rights before exposing an encoder plan", () => {
  const missingRepeat = fixture(); missingRepeat.playlist.versions[1].items.pop();
  assert.equal(planPublishedTimedChannelSequence(missingRepeat).reason, "SEQUENCE_DURATION_INVALID");
  const changedOverlap = fixture(); changedOverlap.playlist.versions[1].items[1].startOffsetSeconds = 240;
  assert.equal(planPublishedTimedChannelSequence(changedOverlap).reason, "SEQUENCE_FROZEN_ORDER_INVALID");
  const changedRights = fixture(); changedRights.playlist.versions[1].items[1].track.permittedUses = ["RETAIL_RADIO"];
  assert.equal(planPublishedTimedChannelSequence(changedRights).reason, "SEQUENCE_RIGHTS_USE_NOT_PERMITTED");
  const licensed = fixture(); licensed.playlist.versions[1].items[1].track.mediaAsset.licensedCatalogue = true;
  assert.equal(planPublishedTimedChannelSequence(licensed).reason, "SEQUENCE_LICENSED_CATALOGUE_OUTPUT_NOT_READY");
  const expired = fixture(); expired.instant = new Date("2026-10-02T10:13:00Z");
  assert.equal(planPublishedTimedChannelSequence(expired).reason, "SEQUENCE_WINDOW_ELAPSED");
});

function fakeDatabase(rows = fixture(), { serviceActive = true } = {}) {
  const calls = [];
  const tx = {
    channel: { findFirst: async () => { calls.push("channel"); return rows.channel; } },
    organisation: { findUnique: async () => {
      calls.push("organisation");
      return { subscription: { status: "ACTIVE", plan: {
        active: true, tierNumber: 3, stationLimit: 1, storageLimitGb: 10,
        listenerLimit: 100, maxBitrateKbps: 128,
        onlineRadioEnabled: serviceActive, licensedMusicCatalogueLevel: "NONE"
      } } };
    } },
    generatedPlaylist: { findFirst: async () => { calls.push("playlist"); return rows.playlist; } },
    generatedPlaylistVersion: { findUnique: async ({ where }) => {
      calls.push("version");
      assert.equal(where.generatedPlaylistId_version.version, 2);
      return rows.playlist.versions[1];
    } },
    programmeSchedule: { findUnique: async () => { calls.push("schedule"); return rows.schedule; } },
    mediaGenre: { findMany: async () => { calls.push("genres"); return []; } }
  };
  return { calls, $transaction: async (operation, options) => {
    assert.equal(options.isolationLevel, "RepeatableRead");
    return operation(tx);
  } };
}

test("a read-only repeatable-read snapshot selects published v2, not the newer draft", async () => {
  const database = fakeDatabase();
  const result = await loadPublishedTimedChannelSequence(database, {
    organisationId: "org-1", channelId: "channel-1", playlistId: "playlist-1", clock: () => now
  });
  assert.equal(result.ready, true);
  assert.equal(result.version, 2);
  assert.deepEqual(result.items.map((item) => item.trackId), ["a", "b", "a"]);
  assert.deepEqual(database.calls, ["channel", "organisation", "playlist", "version", "schedule", "genres"]);
  assert.equal(result.commandIssued, false);
  assert.equal(result.listenerVerified, false);
});

test("the snapshot refuses inactive service, stale reads and database failures", async () => {
  const inactive = fakeDatabase(fixture(), { serviceActive: false });
  assert.equal((await loadPublishedTimedChannelSequence(inactive, {
    organisationId: "org-1", channelId: "channel-1", playlistId: "playlist-1", clock: () => now
  })).reason, "SEQUENCE_SERVICE_INACTIVE");
  assert.deepEqual(inactive.calls, ["channel", "organisation"]);
  let tick = 0;
  assert.equal((await loadPublishedTimedChannelSequence(fakeDatabase(), {
    organisationId: "org-1", channelId: "channel-1", playlistId: "playlist-1",
    clock: () => new Date(now.getTime() + (tick++ * 11_000))
  })).reason, "SEQUENCE_SNAPSHOT_STALE");
  const failed = { $transaction: async () => { throw new Error("private database detail"); } };
  assert.deepEqual(await loadPublishedTimedChannelSequence(failed, {
    organisationId: "org-1", channelId: "channel-1", playlistId: "playlist-1", clock: () => now
  }), { ready: false, reason: "SEQUENCE_SNAPSHOT_FAILED", listenerVerified: false, commandIssued: false });
});
