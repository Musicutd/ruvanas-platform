import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BROADCAST_PROCESSING_TEMPLATES, broadcastEncoding, broadcastProcessingSnapshot, buildBroadcastProcessingFilters, evaluateBroadcastProcessingQc, normalizeBroadcastProcessingProfile } from "../lib/broadcast-audio-processing.mjs";

test("broadcast processing profiles are bounded and produce deterministic filter graphs", () => {
  const profile = normalizeBroadcastProcessingProfile(BROADCAST_PROCESSING_TEMPLATES.WEB_RADIO);
  assert.equal(profile.targetLufs, -16);
  assert.equal(profile.truePeakDbfs, -1.5);
  assert.deepEqual(buildBroadcastProcessingFilters(profile), [
    "highpass=f=30",
    "lowpass=f=18000",
    "acompressor=threshold=-18dB:ratio=2.50:attack=20:release=250",
    "loudnorm=I=-16:TP=-1.5:LRA=12",
    "alimiter=limit=0.8414"
  ]);
  assert.throws(() => normalizeBroadcastProcessingProfile({ ...profile, targetLufs: -30 }), /target loudness/i);
  assert.throws(() => normalizeBroadcastProcessingProfile({ ...profile, highpassHz: 200, lowpassHz: 100 }), /low-pass frequency|below/i);
});

test("output encoding is explicit and profile revisions are immutable snapshots", () => {
  const aac = broadcastEncoding({ ...BROADCAST_PROCESSING_TEMPLATES.TALK_RADIO });
  assert.equal(aac.extension, "m4a");
  assert.equal(aac.mimeType, "audio/mp4");
  assert.match(aac.codecArgs.join(" "), /-c:a aac/);
  const snapshot = broadcastProcessingSnapshot({ id: "profile-1", version: 4, ...BROADCAST_PROCESSING_TEMPLATES.ARCHIVE_MASTER });
  assert.equal(snapshot.profileId, "profile-1");
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.codec, "WAV");
});

test("broadcast QC reports measured loudness, true peak and range without inventing a pass", () => {
  const profile = BROADCAST_PROCESSING_TEMPLATES.WEB_RADIO;
  assert.deepEqual(evaluateBroadcastProcessingQc({ integratedLufs: -16.4, truePeakDbfs: -1.6, loudnessRangeLu: 8.2 }, profile), { status: "PASSED", findings: [] });
  const failed = evaluateBroadcastProcessingQc({ integratedLufs: -13, truePeakDbfs: -0.4, loudnessRangeLu: 16 }, profile);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.findings.length, 3);
  assert.equal(evaluateBroadcastProcessingQc({}, profile).status, "FAILED");
});

test("Stage 19.12 reuses the protected worker with tenant, role and idempotency boundaries", async () => {
  const [route, service, worker, migration, page] = await Promise.all([
    readFile(new URL("../app/api/programming/audio-processing/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/broadcast-audio-processing-service.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/audio-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261013000000_stage_19_12_broadcast_audio_processing/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /contextForRadioClocks/);
  assert.match(route, /canPublishRadioClock/);
  assert.match(service, /organisationId/);
  assert.match(service, /processingKey/);
  assert.match(service, /P2002/);
  assert.match(worker, /broadcast-audio\/renders\/\$\{render\.projectId\}\/\$\{render\.id\}/);
  assert.match(worker, /evaluateBroadcastProcessingQc/);
  assert.match(migration, /AudioRender_processing_contract_check/);
  assert.match(migration, /AudioRender_processingKey_key/);
  assert.match(page, /AudioProcessingWorkspace/);
});
