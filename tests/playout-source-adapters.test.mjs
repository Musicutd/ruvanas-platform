import assert from "node:assert/strict";
import test from "node:test";
import {
  advancedProgrammeCandidates,
  autoDjCandidates,
  currentClockMode,
  currentRundownMode
} from "../lib/playout-source-adapters.mjs";

const organisationId = "org-1";
const channelId = "channel-1";
const instant = new Date("2026-09-07T08:30:30.000Z");
const track = (id = "track-1") => ({
  id,
  title: "Playable track",
  artist: "Artist",
  status: "READY",
  mediaAsset: {
    id: `asset-${id}`,
    organisationId: null,
    libraryType: "RUVANAS_CATALOGUE",
    mediaType: "MUSIC",
    status: "READY",
    durationSeconds: 180
  }
});
const mode = (id = "mode-1") => ({
  id,
  organisationId,
  name: "Music mode",
  slug: id,
  status: "ACTIVE",
  tracks: [{ weight: 100, track: track(`${id}-track`) }]
});
const occurrence = { startsAt: new Date("2026-09-07T08:30:00.000Z"), endsAt: new Date("2026-09-07T09:30:00.000Z") };

test("a published clock adapts its current music item and bounds the next decision", () => {
  const result = currentClockMode({
    id: "clock-1",
    name: "Breakfast clock",
    status: "PUBLISHED",
    version: 2,
    publishedVersion: 2,
    items: [{ id: "clock-item-1", type: "MUSIC_TRACK", label: "Opening song", offsetSeconds: 0, durationSeconds: 180, track: track() }]
  }, occurrence, instant, organisationId);
  assert.equal(result.musicMode.tracks[0].track.id, "track-1");
  assert.equal(result.liveAnchorAt.toISOString(), "2026-09-07T08:30:00.000Z");
  assert.equal(result.validUntil.toISOString(), "2026-09-07T08:33:00.000Z");
});

test("unsupported clock media fails over with an explicit reason", () => {
  const result = currentClockMode({
    id: "clock-1",
    name: "Breakfast clock",
    status: "PUBLISHED",
    version: 1,
    publishedVersion: 1,
    items: [{ id: "promo-1", type: "PROMO", label: "Sponsor", offsetSeconds: 0, durationSeconds: 60 }]
  }, occurrence, instant, organisationId);
  assert.equal(result.musicMode, null);
  assert.equal(result.unavailableReason, "RADIO_CLOCK_PROMO_ADAPTER_UNAVAILABLE");
});

test("an approved rundown adapts its current music track and protects School priority", () => {
  const rundown = {
    id: "rundown-1",
    status: "APPROVED",
    revision: 3,
    approvedRevision: 3,
    episode: { title: "Student breakfast" },
    items: [{ id: "rundown-item-1", position: 0, type: "MUSIC_TRACK", label: "Student choice", estimatedDurationMs: 180000, transitionPreset: "CLEAN", sourceTrack: track() }]
  };
  const direct = currentRundownMode(rundown, occurrence, instant, organisationId);
  assert.equal(direct.musicMode.tracks[0].track.id, "track-1");
  assert.equal(direct.liveAnchorAt.toISOString(), "2026-09-07T08:30:00.000Z");

  const schedule = {
    id: "schedule-1",
    timezone: "UTC",
    versions: [{
      id: "version-1",
      version: 3,
      items: [{
        id: "programme-item-1",
        position: 0,
        label: "Student breakfast",
        recurrence: "ONE_OFF",
        sourceType: "SHOW_RUNDOWN",
        startsAt: occurrence.startsAt,
        durationMinutes: 60,
        priority: 20,
        schoolRundownId: rundown.id,
        schoolRundown: rundown
      }]
    }]
  };
  const candidates = advancedProgrammeCandidates(schedule, instant, organisationId, channelId);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceType, "SCHOOL_PROGRAMMING");
  assert.equal(candidates[0].priority, 1020);
  assert.equal(candidates[0].payload.resolution.reason, "PROGRAMME_SHOW_RUNDOWN");
});

test("Advanced Scheduler Music Modes become playable programme candidates", () => {
  const schedule = {
    id: "schedule-1",
    timezone: "UTC",
    versions: [{ id: "version-1", version: 2, items: [{
      id: "programme-item-1",
      position: 0,
      label: "Breakfast",
      recurrence: "ONE_OFF",
      sourceType: "MUSIC_MODE",
      startsAt: occurrence.startsAt,
      durationMinutes: 60,
      priority: 10,
      musicModeId: "mode-1",
      musicMode: mode()
    }] }]
  };
  const candidates = advancedProgrammeCandidates(schedule, instant, organisationId, channelId);
  assert.equal(candidates[0].available, true);
  assert.equal(candidates[0].priority, 810);
  assert.equal(candidates[0].payload.resolution.reason, "PROGRAMME_MUSIC_MODE");
});

test("AutoDJ adapters expose default and backup independently", () => {
  const candidates = autoDjCandidates({
    enabled: true,
    playbackPolicy: "RUN_24_7",
    defaultMusicMode: { ...mode("default"), status: "DRAFT" },
    backupMusicMode: mode("backup")
  }, { organisationId, channelId, instant, locationOpen: true, local: { date: "2026-09-07" } });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].available, false);
  assert.equal(candidates[0].unavailableReason, "NO_PLAYABLE_TRACKS");
  assert.equal(candidates[1].available, true);
  assert.equal(candidates[1].payload.resolution.reason, "BACKUP_AUTODJ");
});
