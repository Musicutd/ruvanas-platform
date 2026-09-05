import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertVoiceTrackSegueApprovable, normalizeVoiceTrackSegue, safeVoiceTrackSegue, voiceTrackSegueTimeline } from "../lib/voice-tracking-segue.mjs";

const input = {
  title: "Breakfast link",
  channelId: "channel-1",
  audioRenderId: "render-1",
  outgoingTrackId: "track-out",
  incomingTrackId: "track-in",
  outgoingCueOutMs: 180000,
  voiceTrimStartMs: 500,
  voiceTrimEndMs: 10500,
  incomingIntroEndMs: 15000,
  outgoingOverlapMs: 2000,
  incomingOverlapMs: 2500,
  duckingDb: -12
};
const durations = { voiceDurationMs: 12000, outgoingDurationMs: 200000, incomingDurationMs: 220000 };

test("voice-track cue math creates a deterministic three-part segue", () => {
  const normalized = normalizeVoiceTrackSegue(input, durations);
  assert.equal(normalized.timeline.voiceDurationMs, 10000);
  assert.equal(normalized.timeline.voiceStartsAtMs, 178000);
  assert.equal(normalized.timeline.voiceEndsAtMs, 188000);
  assert.equal(normalized.timeline.incomingStartsAtMs, 185500);
  assert.equal(normalized.timeline.packageDurationMs, 22500);
  assert.deepEqual(voiceTrackSegueTimeline(normalized), normalized.timeline);
});

test("cue, overlap and ducking values fail closed at protected source bounds", () => {
  assert.throws(() => normalizeVoiceTrackSegue({ ...input, outgoingCueOutMs: 200001 }, durations), /outgoing cue/i);
  assert.throws(() => normalizeVoiceTrackSegue({ ...input, voiceTrimEndMs: 12001 }, durations), /voice end cue/i);
  assert.throws(() => normalizeVoiceTrackSegue({ ...input, incomingOverlapMs: 16000 }, durations), /incoming overlap/i);
  assert.throws(() => normalizeVoiceTrackSegue({ ...input, outgoingOverlapMs: 6000, incomingOverlapMs: 5000 }, durations), /two overlaps/i);
  assert.throws(() => normalizeVoiceTrackSegue({ ...input, duckingDb: 1 }, durations), /ducking/i);
});

test("approval requires an audible acknowledgement and current reviewed audio", () => {
  const ready = { status: "DRAFT", audioRender: { status: "SUCCEEDED" }, voicePromoVersion: { status: "APPROVED", qcStatus: "PASSED", mediaAsset: { status: "READY" } }, outgoingTrack: { status: "READY", mediaAsset: { status: "READY" } }, incomingTrack: { status: "READY", mediaAsset: { status: "READY" } } };
  assert.throws(() => assertVoiceTrackSegueApprovable(ready), /Listen to the complete segue/i);
  assert.equal(assertVoiceTrackSegueApprovable(ready, { previewAcknowledged: true }), true);
  assert.throws(() => assertVoiceTrackSegueApprovable({ ...ready, voicePromoVersion: { ...ready.voicePromoVersion, qcStatus: "FAILED" } }, { previewAcknowledged: true }), /quality-checked/i);
});

test("safe segue output exposes playable labels without tenant or storage secrets", () => {
  const date = new Date("2026-09-05T10:00:00.000Z");
  const safe = safeVoiceTrackSegue({ ...input, id: "segue-1", status: "APPROVED", version: 2, organisationId: "org-secret", audioProject: { id: "project-1", title: "Link", type: "VOICE_TRACK" }, audioRender: { status: "SUCCEEDED" }, voicePromoVersion: { mediaAssetId: "voice-media", mediaAsset: { durationSeconds: 12, storageKey: "secret" }, promoAsset: { name: "Voice link" } }, outgoingTrack: { id: "track-out", title: "Out", artist: "Artist A", mediaAssetId: "out-media", mediaAsset: { durationSeconds: 200 } }, incomingTrack: { id: "track-in", title: "In", artist: "Artist B", mediaAssetId: "in-media", mediaAsset: { durationSeconds: 220 } }, channel: { id: "channel-1", name: "Main" }, approvedAt: date, updatedAt: date });
  assert.equal(safe.voice.streamUrl, "/api/media/voice-media/stream");
  assert.equal(safe.outgoingTrack.name, "Artist A — Out");
  assert.equal(JSON.stringify(safe).includes("org-secret"), false);
  assert.equal(JSON.stringify(safe).includes("storageKey"), false);
});

test("Stage 19.11 reuses AudioLab, Radio Clocks and protected media routes", async () => {
  const [schema, migration, route, service, rules, clockRules, clockService, page, ui, roadmap, documentation] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261012000000_stage_19_11_voice_tracking_segue/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/voice-tracking/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/voice-tracking-segue-service.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/voice-tracking-segue.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-clocks.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-clock-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/VoiceTrackingWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-11-voice-tracking-segue.md", import.meta.url), "utf8")
  ]);
  assert.match(schema, /model VoiceTrackSegue/);
  assert.match(schema, /audioProject\s+AudioProject/);
  assert.match(migration, /VoiceTrackSegue_cue_bounds_check/);
  assert.match(migration, /"type" = 'VOICE_TRACK'.*"voiceTrackSegueId" IS NOT NULL/s);
  assert.match(migration, /RadioClockItem_voiceTrackSegueId_fkey/);
  assert.match(route, /contextForRadioClocks/);
  assert.doesNotMatch(route, /body\.organisationId/);
  assert.match(service, /musicTrackEligibility/);
  assert.match(service, /outputPromoVersion.*APPROVED/);
  assert.match(rules, /MAX_SEGUE_OVERLAP_MS/);
  assert.match(clockRules, /VOICE_TRACK.*voiceTrackSegueId/s);
  assert.match(clockService, /current approved voice-track segue/);
  assert.match(page, /VoiceTrackingWorkspace/);
  assert.match(ui, /AudioContext/);
  assert.match(ui, /Play complete segue/);
  assert.match(roadmap, /19\.11 \| Voice Tracking \/ Segue \| DEPLOYED \| \[#110\]/);
  assert.match(documentation, /does not create another recorder, media library, scheduler or playout engine/);
});
