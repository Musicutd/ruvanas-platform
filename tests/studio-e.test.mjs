import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  applyMultitrackCrossfade,
  crossfadeDuration,
  moveMultitrackClip,
  normalizeMultitrackState,
  studioMultitrackTrackLimit
} from "../lib/multitrack-studio.mjs";

const firstClip = { clientId: "first", mediaAssetId: "asset-1", sourceStartMs: 0, sourceEndMs: 10_000, timelineStartMs: 0, fadeInMs: 0, fadeOutMs: 0 };
const secondClip = { clientId: "second", mediaAssetId: "asset-2", sourceStartMs: 0, sourceEndMs: 8_000, timelineStartMs: 10_000, fadeInMs: 0, fadeOutMs: 0 };
const project = {
  tracks: [
    { clientId: "voice", name: "Voice", kind: "VOICE", clips: [firstClip, secondClip] },
    { clientId: "music", name: "Music", kind: "MUSIC", clips: [] }
  ]
};

test("Studio E enforces plan-aware 8 and 16 track limits", () => {
  assert.equal(studioMultitrackTrackLimit({ planTierNumber: 1, studioLevel: "BASIC" }), 8);
  assert.equal(studioMultitrackTrackLimit({ planTierNumber: 2, studioLevel: "BASIC" }), 8);
  assert.equal(studioMultitrackTrackLimit({ planTierNumber: 3, studioLevel: "PRO" }), 16);
  assert.equal(studioMultitrackTrackLimit({ planTierNumber: 5, studioLevel: "PRO" }), 16);
  const tracks = Array.from({ length: 16 }, (_, index) => ({ clientId: `track-${index}`, clips: [] }));
  assert.equal(normalizeMultitrackState({ tracks }, { maxTracks: 8 }).tracks.length, 8);
});

test("Studio E moves a protected clip without changing its source edit", () => {
  const moved = moveMultitrackClip(project, { fromTrackId: "voice", toTrackId: "music", clipId: "first", timelineStartMs: 4_250 }, { maxTracks: 8 });
  assert.equal(moved.tracks[0].clips.some((clip) => clip.clientId === "first"), false);
  assert.equal(moved.tracks[1].clips[0].timelineStartMs, 4_250);
  assert.equal(moved.tracks[1].clips[0].mediaAssetId, "asset-1");
  assert.equal(moved.tracks[1].clips[0].sourceStartMs, 0);
  assert.equal(moved.tracks[1].clips[0].sourceEndMs, 10_000);
});

test("Studio E creates and removes explicit adjacent clip crossfades", () => {
  const mixed = applyMultitrackCrossfade(project, { trackId: "voice", leftClipId: "first", rightClipId: "second", durationMs: 2_000 });
  const [left, right] = mixed.tracks[0].clips;
  assert.equal(right.timelineStartMs, 8_000);
  assert.equal(left.fadeOutMs, 2_000);
  assert.equal(right.fadeInMs, 2_000);
  assert.equal(crossfadeDuration(left, right), 2_000);

  const separated = applyMultitrackCrossfade(mixed, { trackId: "voice", leftClipId: "first", rightClipId: "second", durationMs: 0 });
  assert.equal(separated.tracks[0].clips[1].timelineStartMs, 10_000);
  assert.equal(crossfadeDuration(...separated.tracks[0].clips), 0);
});

test("Studio E exposes visual timeline controls and enforces the limit on the server", async () => {
  const [client, collectionRoute, projectRoute] = await Promise.all([
    readFile(new URL("../app/dashboard/school-radio/MultitrackStudioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/multitrack/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/multitrack/projects/[projectId]/route.js", import.meta.url), "utf8")
  ]);
  assert.match(client, /Timeline zoom/);
  assert.match(client, /onDragStart/);
  assert.match(client, /Clip transitions/);
  assert.match(client, /ArrowLeft/);
  assert.match(collectionRoute, /studioMultitrackTrackLimit/);
  assert.match(projectRoute, /supports up to/);
  assert.match(projectRoute, /maxTracks: trackLimit/);
});
