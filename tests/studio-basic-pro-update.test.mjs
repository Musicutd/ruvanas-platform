import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveEntitlements, studioExternalDestinationLimit, studioLevelForTier } from "../lib/entitlements.mjs";
import { assertStudioMultitrackWriteAllowed, splitMultitrackClip, studioMultitrackTrackLimit } from "../lib/multitrack-studio.mjs";
import { assertStudioWaveformWriteAllowed } from "../lib/waveform-editor.mjs";
import { fallbackForQueue, playoutModeTransition, studioQueueReadiness } from "../lib/studio-playout.mjs";
import { assertDestinationCapacity, broadcastMetadata, safeStudioDestination } from "../lib/studio-broadcast.mjs";

function plan(tierNumber, productFamily = "RETAIL") {
  return { active: true, name: `${productFamily} Tier ${tierNumber}`, code: `${productFamily}_${tierNumber}`, productFamily, tierNumber, stationLimit: tierNumber, storageLimitGb: 20, listenerLimit: 100, maxBitrateKbps: 192, includesRuvanasCatalogue: tierNumber >= 3, licensedMusicCatalogueLevel: tierNumber >= 3 ? "FOCUSED" : "NONE", promoUploadEnabled: true };
}

test("all six product families derive Studio Basic or Pro exclusively from canonical tier authority", () => {
  for (const productFamily of ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]) {
    for (const tierNumber of [1, 2, 3, 4, 5]) {
      const entitlements = resolveEntitlements({ status: "ACTIVE", plan: plan(tierNumber, productFamily) });
      assert.equal(entitlements.studioLevel, tierNumber <= 2 ? "BASIC" : "PRO");
      assert.equal(entitlements.studioMultitrackTrackLimit, tierNumber <= 2 ? 8 : 16);
      assert.equal(entitlements.planProductFamily, productFamily);
    }
  }
  assert.equal(studioLevelForTier(2), "BASIC");
  assert.equal(studioLevelForTier(3), "PRO");
});

test("Basic rejects Pro-only edit decisions without deleting them", () => {
  const basic = { studioLevel: "BASIC", planTierNumber: 2 };
  assert.throws(() => assertStudioWaveformWriteAllowed({ markers: [{ label: "Intro" }], clips: [] }, basic), /Studio Pro/);
  assert.throws(() => assertStudioMultitrackWriteAllowed({ tracks: [{ gainDb: 1, clips: [] }] }, basic), /Studio Pro/);
  assert.equal(studioMultitrackTrackLimit(basic), 8);
});

test("Pro Blade split remains non-destructive and supports sixteen tracks", () => {
  const original = { tracks: [{ clientId: "voice", clips: [{ clientId: "clip", mediaAssetId: "asset", sourceStartMs: 1_000, sourceEndMs: 9_000, timelineStartMs: 2_000 }] }] };
  const split = splitMultitrackClip(original, { trackId: "voice", clipId: "clip", timelinePositionMs: 6_000, idFactory: (() => { let value = 0; return () => `split-${++value}`; })() }, { maxTracks: 16 });
  assert.equal(original.tracks[0].clips.length, 1);
  assert.equal(split.tracks[0].clips.length, 2);
  assert.deepEqual(split.tracks[0].clips.map((clip) => [clip.sourceStartMs, clip.sourceEndMs]), [[1_000, 5_000], [5_000, 9_000]]);
  assert.equal(studioMultitrackTrackLimit({ studioLevel: "PRO", planTierNumber: 3 }), 16);
});

test("Manual Playout requires fallback and returns to AutoDJ when its queue empties", () => {
  assert.throws(() => playoutModeTransition({ status: "ACTIVE" }, "MANUAL"), /fallback/);
  assert.equal(playoutModeTransition({ status: "FALLBACK" }, "MANUAL", { hasFallback: true }).status, "ACTIVE");
  const fallback = fallbackForQueue({ mode: "MANUAL" }, []);
  assert.deepEqual({ mode: fallback.mode, status: fallback.status, outputHealth: fallback.outputHealth }, { mode: "AUTO", status: "FALLBACK", outputHealth: "AUTODJ_FALLBACK" });
});

test("catalogue use, external destination caps, safe credentials and metadata are explicit", () => {
  const catalogueAsset = { status: "READY", organisationId: null, libraryType: "RUVANAS_CATALOGUE", track: { status: "READY", licenceExpiresAt: null } };
  assert.equal(studioQueueReadiness(catalogueAsset, { licensedMusicCatalogueEnabled: false }).ready, false);
  assert.equal(studioQueueReadiness(catalogueAsset, { licensedMusicCatalogueEnabled: true }).ready, true);
  assert.deepEqual([1, 2, 3, 4, 5].map((tier) => studioExternalDestinationLimit(tier)), [0, 0, 2, 5, 10]);
  assert.throws(() => assertDestinationCapacity({ tierNumber: 3, activeCount: 1, requestedCount: 2 }), /2 simultaneous/);
  assert.equal(assertDestinationCapacity({ tierNumber: 5, customLimit: 14, activeCount: 10, requestedCount: 4 }), 14);
  const safe = safeStudioDestination({ id: "destination", credentialEncrypted: "secret", listenerCount: 12, listenerTelemetryAt: null });
  assert.equal("credentialEncrypted" in safe, false);
  assert.equal(safe.listenerCount, null);
  assert.equal(broadcastMetadata({ currentItem: { artistOrProgramme: "Presenter", title: "Morning" } }), "Presenter — Morning");
});

test("shared Studio APIs enforce idempotency, optimistic concurrency and worker-owned continuity", async () => {
  const [playout, broadcast, broadcastWorker, manualUi, multitrackUi, worker, schema, hub] = await Promise.all([
    readFile(new URL("../app/api/studio/playout/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/broadcast/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/studio-broadcast-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/ManualPlayoutClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/MultitrackStudioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/StudioHubClient.js", import.meta.url), "utf8")
  ]);
  assert.match(playout, /Idempotency-Key/);
  assert.match(playout, /expectedRevision/);
  assert.match(playout, /CREATE_PACK/);
  assert.match(playout, /SCHEDULED_PRIORITY/);
  assert.match(playout, /SEND_NEXT/);
  assert.match(broadcast, /Idempotency-Key/);
  assert.match(broadcast, /activeExternalLinks/);
  assert.match(broadcastWorker, /studio-destinations\/metadata/);
  assert.match(manualUi, /NOW PLAYING/);
  assert.match(manualUi, /Send to Next/);
  assert.match(multitrackUi, /Fit Selection/);
  assert.match(multitrackUi, /Trim left/);
  assert.match(worker, /reconcileStudioProEntitlements/);
  assert.match(schema, /model StudioBroadcastCommand/);
  assert.match(hub, /HEALTH:/);
  assert.match(hub, /FAITH:/);
});
