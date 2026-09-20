import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadStudioIsolatedHandoffCandidate, loadStudioOnlineAdmission, recheckStudioIsolatedHandoffCandidate } from "../lib/studio-online-admission.mjs";

const instant = new Date("2026-09-21T12:00:00Z");
const input = { stationId: "station-1", workerOwner: "worker-1", clock: () => instant };
const isolation = {
  acknowledgement: "ISOLATED_TEST_STREAM",
  testListenerUrl: "https://ruvanas_studio_test-radio105network.radioca.st/stream",
  testSourceHost: "pollux.shoutca.st", testSourcePort: 8198,
  productionListenerUrl: "https://plus-radio105network.radioca.st/stream",
  productionSourceHost: "pollux.shoutca.st", productionSourcePort: 8393
};

function fixture(changes = {}) {
  const asset = {
    id: "manual-asset", organisationId: "org-1", status: "READY", mediaType: "AUDIO",
    libraryType: "ORGANISATION_AUDIO", durationSeconds: 60, storageKey: "private/manual.mp3"
  };
  const track = {
    id: "track-1", status: "READY", updatedAt: instant, licenceStartsAt: null, licenceExpiresAt: null,
    mediaAsset: {
      id: "rotation-asset", updatedAt: instant, status: "READY", mediaType: "MUSIC",
      libraryType: "RUVANAS_CATALOGUE", organisationId: null, licensedCatalogue: false,
      durationSeconds: 180, storageKey: "core/test.mp3"
    }
  };
  const station = {
    id: "station-1", organisationId: "org-1", productFamily: "ONLINE", status: "PENDING_SETUP",
    name: "Test Station", maxBitrateKbps: 128,
    streamConfig: {
      outboundAutoDjEnabled: true, providerKey: "CENTOVA_CAST", serverHost: "stream.example.com",
      sourcePort: 8393, sourcePasswordEncrypted: "ciphertext", bitrateKbps: 128,
      encoderLeaseOwner: "worker-1", encoderLeaseUntil: new Date(instant.getTime() + 30_000)
    },
    organisation: { subscription: { status: "ACTIVE", plan: {
      active: true, tierNumber: 3, stationLimit: 1, storageLimitGb: 10, listenerLimit: 100,
      maxBitrateKbps: 128, onlineRadioEnabled: true, licensedMusicCatalogueLevel: "NONE"
    } } },
    channels: [{
      id: "channel-1", stationId: "station-1", organisationId: "org-1", status: "ACTIVE",
      autoDjPolicy: {
        id: "policy-1", enabled: true, state: "ACTIVE", playbackPolicy: "RUN_24_7",
        rightsUse: "ONLINE_RADIO", sourceScopes: ["RUVANAS_CORE"], selectedGenreCodes: [],
        defaultMusicMode: { id: "mode-1", status: "ACTIVE", tracks: [{ track, weight: 100, position: 0 }] },
        backupMusicMode: null, updatedAt: instant
      }
    }]
  };
  const session = {
    id: "session-1", organisationId: "org-1", channelId: "channel-1", productFamily: "ONLINE",
    status: "ACTIVE", mode: "MANUAL", fallbackAutoDjId: "policy-1", revision: 1
  };
  const item = {
    id: "item-1", sessionId: "session-1", organisationId: "org-1", mediaAssetId: "manual-asset",
    area: "LIVE", status: "READY", rightsReady: true, durationMs: 60_000,
    cueInMs: 0, cueOutMs: null, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, updatedAt: instant
  };
  return { station, session, item, asset, ...changes };
}

function fakeDatabase(rows = fixture()) {
  const calls = [];
  const tx = {
    station: { findUnique: async () => { calls.push("station"); return rows.station; } },
    mediaGenre: { findMany: async () => { calls.push("mediaGenre"); return []; } },
    studioPlayoutSession: { findMany: async () => { calls.push("studioPlayoutSession"); return rows.sessions ?? [rows.session]; } },
    studioPlayoutItem: { findMany: async () => { calls.push("studioPlayoutItem"); return rows.items ?? [rows.item]; } },
    mediaAsset: { findFirst: async () => { calls.push("mediaAsset"); return rows.asset; } },
    channel: { findFirst: async () => { calls.push("channel"); return rows.channel ?? { id: "channel-1" }; } },
    programmeSchedule: { findFirst: async () => { calls.push("programmeSchedule"); return rows.programmeSchedule ?? null; } }
  };
  for (const model of ["campaign", "radioAdvertisingPolicy", "playoutIntent", "channelAssignment", "radioSyndicationAgreement", "externalLiveSource", "liveStudioSession"]) {
    tx[model] = { findFirst: async () => { calls.push(model); return rows[model] ?? null; } };
  }
  tx.liveFailoverPolicy = { findUnique: async () => { calls.push("liveFailoverPolicy"); return rows.liveFailoverPolicy ?? null; } };
  return {
    calls, transactionOptions: null,
    async $transaction(callback, options) {
      this.transactionOptions = options;
      return callback(tx);
    }
  };
}

test("one read-only repeatable-read snapshot covers lease, fallback, queue, asset and programming", async () => {
  const database = fakeDatabase();
  const decision = await loadStudioOnlineAdmission(database, input);
  assert.deepEqual(decision, { ready: true, reason: "ADMISSION_ELIGIBLE_NOT_ON_AIR" });
  assert.deepEqual(database.transactionOptions, { isolationLevel: "RepeatableRead" });
  assert.deepEqual(database.calls.slice(0, 6), [
    "station", "mediaGenre", "studioPlayoutSession", "studioPlayoutItem", "mediaAsset", "channel"
  ]);
  assert.ok(database.calls.includes("liveStudioSession"));
  assert.equal("itemId" in decision, false);
  assert.equal("listenerVerified" in decision, false);
});

test("lease, product, tenant, Studio entitlement and rights mismatches fail closed", async () => {
  const lease = fixture(); lease.station.streamConfig.encoderLeaseOwner = "another-worker";
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(lease), input)).reason, "ADMISSION_LEASE_UNAVAILABLE");
  const tenant = fixture(); tenant.station.channels[0].organisationId = "org-2";
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(tenant), input)).reason, "ADMISSION_CHANNEL_MISMATCH");
  const product = fixture(); product.station.productFamily = "RETAIL";
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(product), input)).ready, false);
  const basic = fixture(); basic.station.organisation.subscription.plan.tierNumber = 1;
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(basic), input)).reason, "SERVICE_OR_STUDIO_PRO_INACTIVE");
  const rights = fixture(); rights.item.rightsReady = false;
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(rights), input)).reason, "STUDIO_ITEM_NOT_READY");
  const port = fixture(); port.station.streamConfig.sourcePort = 65536;
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(port), input)).reason, "ADMISSION_SOURCE_PORT_INVALID");
  const bitrate = fixture(); bitrate.station.streamConfig.bitrateKbps = 320;
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(bitrate), input)).reason, "BITRATE_NOT_ALLOWED");
  const expired = fixture(); expired.station.channels[0].autoDjPolicy.defaultMusicMode.tracks[0].track.licenceExpiresAt = new Date(instant.getTime() - 86_400_000);
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(expired), input)).reason, "NO_RIGHTS_APPROVED_AUDIO");
});

test("protected programming, ambiguity, failures and a slow snapshot cannot authorise Manual output", async () => {
  const campaign = fixture({ campaign: { id: "campaign-1" } });
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(campaign), input)).reason, "AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
  const ambiguous = fixture({ sessions: [fixture().session, { ...fixture().session, id: "session-2" }] });
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(ambiguous), input)).reason, "ADMISSION_SESSIONS_AMBIGUOUS");
  const database = fakeDatabase();
  database.$transaction = async () => { throw new Error("database unavailable"); };
  assert.deepEqual(await loadStudioOnlineAdmission(database, input), { ready: false, reason: "ADMISSION_SNAPSHOT_FAILED" });
  let ticks = 0;
  const clock = () => new Date(instant.getTime() + (ticks++ ? 11_000 : 0));
  assert.equal((await loadStudioOnlineAdmission(fakeDatabase(), { ...input, clock })).reason, "ADMISSION_SNAPSHOT_STALE");
});

test("the optional worker scan uses the snapshot but cannot switch audio or unlock live controls", async () => {
  const [worker, playout] = await Promise.all([
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/studio-playout.mjs", import.meta.url), "utf8")
  ]);
  assert.match(worker, /RUVANAS_STUDIO_HANDOFF_SHADOW === "1"/);
  assert.match(worker, /loadStudioOnlineAdmission/);
  assert.doesNotMatch(worker, /pushPreparedStudioAudio|studio-encoder-transport/);
  assert.match(playout, /connected: false/);
});

test("a short-lived isolated handoff candidate binds the exact test endpoint without authorising output", async () => {
  const rows = fixture();
  rows.station.streamConfig.streamUrl = isolation.testListenerUrl;
  rows.station.streamConfig.serverHost = isolation.testSourceHost;
  rows.station.streamConfig.sourcePort = isolation.testSourcePort;
  const decision = await loadStudioIsolatedHandoffCandidate(fakeDatabase(rows), { ...input, isolation });
  assert.equal(decision.ready, true);
  assert.equal(decision.reason, "ADMISSION_CANDIDATE_NOT_ON_AIR");
  assert.equal(decision.sourceCommandAllowed, false);
  assert.equal(decision.listenerVerified, false);
  assert.equal(decision.candidate.itemId, rows.item.id);
  assert.equal(decision.candidate.mediaAssetId, rows.asset.id);
  assert.equal(decision.candidate.source, "pollux.shoutca.st:8198");
  assert.equal(decision.candidate.validUntil - decision.candidate.checkedAt, 5_000);
  assert.equal(Object.hasOwn(decision.candidate, "storageKey"), false);
  assert.equal(JSON.stringify(decision).includes("ciphertext"), false);
  assert.deepEqual(await loadStudioOnlineAdmission(fakeDatabase(rows), input), { ready: true, reason: "ADMISSION_ELIGIBLE_NOT_ON_AIR" });
});

test("isolated handoff refuses missing acknowledgement, mismatched test endpoint and protected production source", async () => {
  const rows = fixture();
  rows.station.streamConfig.streamUrl = isolation.testListenerUrl;
  rows.station.streamConfig.serverHost = isolation.testSourceHost;
  rows.station.streamConfig.sourcePort = isolation.testSourcePort;
  assert.equal((await loadStudioIsolatedHandoffCandidate(fakeDatabase(rows), input)).reason, "ADMISSION_ISOLATION_REQUIRED");
  assert.equal((await loadStudioIsolatedHandoffCandidate(fakeDatabase(rows), { ...input, isolation: { ...isolation, acknowledgement: "" } })).reason, "ADMISSION_ISOLATED_TARGET_MISMATCH");
  const wrong = fixture();
  wrong.station.streamConfig.streamUrl = isolation.testListenerUrl;
  wrong.station.streamConfig.serverHost = isolation.testSourceHost;
  wrong.station.streamConfig.sourcePort = 8199;
  assert.equal((await loadStudioIsolatedHandoffCandidate(fakeDatabase(wrong), { ...input, isolation })).reason, "ADMISSION_ISOLATED_TARGET_MISMATCH");
  const production = fixture();
  production.station.streamConfig.streamUrl = isolation.productionListenerUrl;
  production.station.streamConfig.serverHost = isolation.productionSourceHost;
  production.station.streamConfig.sourcePort = isolation.productionSourcePort;
  const result = await loadStudioIsolatedHandoffCandidate(fakeDatabase(production), { ...input, isolation });
  assert.equal(result.ready, false);
  assert.equal(result.candidate, null);
  assert.equal(result.sourceCommandAllowed, false);
  assert.equal(result.listenerVerified, false);
});

test("a second snapshot rejects stale or changed handoffs and still never commands audio", async () => {
  const rows = fixture();
  rows.station.streamConfig.streamUrl = isolation.testListenerUrl;
  rows.station.streamConfig.serverHost = isolation.testSourceHost;
  rows.station.streamConfig.sourcePort = isolation.testSourcePort;
  const prepared = await loadStudioIsolatedHandoffCandidate(fakeDatabase(rows), { ...input, isolation });
  const at = new Date(instant.getTime() + 1_000);
  const recheck = (database, clock = () => at) => recheckStudioIsolatedHandoffCandidate(database, {
    candidate: prepared.candidate, isolation, workerOwner: input.workerOwner, clock
  });
  const consistent = await recheck(fakeDatabase(rows));
  assert.equal(consistent.reason, "ADMISSION_RECHECK_CONSISTENT_NOT_ON_AIR");
  assert.equal(consistent.sourceCommandAllowed, false);
  assert.equal(consistent.listenerVerified, false);
  assert.equal((await recheck(fakeDatabase(rows), () => new Date(instant.getTime() + 5_000))).reason, "ADMISSION_CANDIDATE_EXPIRED_OR_INVALID");
  let ticks = 0;
  assert.equal((await recheck(fakeDatabase(rows), () => new Date(instant.getTime() + (ticks++ < 2 ? 1_000 : 6_000)))).reason, "ADMISSION_CANDIDATE_EXPIRED_OR_INVALID");
  const changed = fixture();
  changed.station.streamConfig.streamUrl = isolation.testListenerUrl;
  changed.station.streamConfig.serverHost = isolation.testSourceHost;
  changed.station.streamConfig.sourcePort = isolation.testSourcePort;
  changed.item.updatedAt = new Date(instant.getTime() + 500);
  assert.equal((await recheck(fakeDatabase(changed))).reason, "ADMISSION_CANDIDATE_CHANGED");
  changed.item.rightsReady = false;
  assert.equal((await recheck(fakeDatabase(changed))).reason, "STUDIO_ITEM_NOT_READY");
  changed.station.streamConfig.encoderLeaseOwner = "another-worker";
  assert.equal((await recheck(fakeDatabase(changed))).reason, "ADMISSION_LEASE_UNAVAILABLE");
});
