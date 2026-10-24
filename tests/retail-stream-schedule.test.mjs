import test from "node:test";
import assert from "node:assert/strict";
import { loadRetailStreamSchedule } from "../lib/retail-stream-schedule.mjs";

function fixture() {
  const now = new Date("2026-10-24T07:59:00Z"), organisationId = "org-retail", stationId = "station-retail";
  const mode = { id: "mode-retail", organisationId, status: "ACTIVE", smartPlaylist: { organisationId,
    musicModeId: "mode-retail", status: "ACTIVE", rightsUse: "RETAIL_RADIO", simpleBuildMode: "RANDOM_GENRE_POOL", genreCodes: ["pop"] } };
  const item = { id: "item-retail", organisationId, versionId: "version-retail", position: 0, label: "Saturday mix", recurrence: "WEEKLY",
    sourceType: "MUSIC_MODE", weekday: 6, startMinute: 600, startsAt: null, durationMinutes: 60, priority: 0,
    musicModeId: mode.id, musicMode: mode, radioClockId: null, schoolRundownId: null };
  const version = { id: "version-retail", organisationId, scheduleId: "schedule-retail", status: "PUBLISHED", isActive: true,
    version: 1, publishedAt: new Date("2026-10-23T07:00:00Z"), publishedByUserId: "owner", publishedBy: { id: "owner", role: "SUPER_ADMIN" }, items: [item] };
  const schedule = { id: "schedule-retail", organisationId, channelId: "channel-retail", name: "Week", timezone: "Europe/Malta", versions: [version] };
  const channel = { id: "channel-retail", organisationId, stationId };
  for (const row of [item, mode, mode.smartPlaylist]) row.updatedAt = new Date("2026-10-23T06:00:00Z");
  const calls = [];
  const db = { channel: { findMany: async request => { calls.push(request); return [channel]; } },
    programmeSchedule: { findFirst: async request => { calls.push(request); return schedule; } } };
  const authorized = { station: { id: stationId, organisationId, productFamily: "RETAIL" },
    grant: { stationId, organisationId, issuedAt: "2026-10-23T08:00:00Z" },
    tracks: [{ track: { id: "track-retail", mediaAssetId: "asset-retail", mediaAsset: { genres: [{ mediaGenre: { slug: "pop" } }] } }, fingerprint: "fingerprint", durationSeconds: 120 }] };
  return { now, db, authorized, schedule, channel, version, item, mode, calls };
}
test("owner-published Retail week keeps exact local start/end and source scope", async () => {
  const f = fixture(); const result = await loadRetailStreamSchedule(f.db, f);
  assert.equal(result.enabled, true); assert.equal(result.occurrences[0].startsAt, "2026-10-24T08:00:00.000Z");
  assert.equal(result.occurrences[0].endsAt, "2026-10-24T09:00:00.000Z");
  assert.equal(result.occurrences[0].tracks[0].trackId, "track-retail");
  assert.equal(f.calls[0].where.stationId, f.authorized.station.id);
  assert.equal(f.calls[0].where.musicRightsUse, "RETAIL_RADIO");
});
test("subscriber publication, drafts, mixed tenants and other pillars cannot take over", async () => {
  for (const change of [f => { f.version.publishedBy.role = "OWNER"; }, f => { f.version.status = "DRAFT"; },
    f => { f.channel.organisationId = "other"; }, f => { f.item.organisationId = "other"; },
    f => { f.mode.smartPlaylist.rightsUse = "ONLINE_RADIO"; }, f => { f.authorized.station.productFamily = "ONLINE"; },
    f => { f.version.isActive = false; }, f => { f.authorized.tracks = []; }]) {
    const f = fixture(); change(f); assert.equal((await loadRetailStreamSchedule(f.db, f)).enabled, false);
  }
});
test("no Retail schedule leaves random programme available without creating a channel", async () => {
  const f = fixture(); f.db.channel.findMany = async () => [];
  const result = await loadRetailStreamSchedule(f.db, f);
  assert.equal(result.enabled, false); assert.equal(result.reasonCode, "RETAIL_SCHEDULE_NOT_CONFIGURED");
});
test("expired eligibility removes a scheduled recording and changed source changes revision", async () => {
  const f = fixture(); const first = await loadRetailStreamSchedule(f.db, f);
  f.authorized.tracks[0].fingerprint = "updated-recording";
  const second = await loadRetailStreamSchedule(f.db, f);
  assert.notEqual(first.revisionFingerprint, second.revisionFingerprint);
  f.authorized.tracks[0].track.mediaAsset.genres = [];
  assert.equal((await loadRetailStreamSchedule(f.db, f)).enabled, false);
});

test("a later subscriber playlist or programme edit needs fresh owner publication", async () => {
  for (const target of ["playlist", "mode", "item"]) {
    const f = fixture();
    const changed = target === "playlist" ? f.mode.smartPlaylist : f[target];
    changed.updatedAt = new Date("2026-10-24T07:00:00Z");
    const blocked = await loadRetailStreamSchedule(f.db, f);
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.reasonCode, "RETAIL_SCHEDULE_REAPPROVAL_REQUIRED");
    f.version.publishedAt = new Date("2026-10-24T07:30:00Z");
    assert.equal((await loadRetailStreamSchedule(f.db, f)).enabled, true);
  }
  const f = fixture(); delete f.mode.smartPlaylist.updatedAt;
  assert.equal((await loadRetailStreamSchedule(f.db, f)).enabled, false);
});
