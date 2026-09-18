import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inspectStudioOnlineHandoff } from "../lib/studio-online-shadow.mjs";

const instant = new Date("2026-09-18T12:00:00Z");
const lease = { outboundAutoDjEnabled: true, encoderLeaseOwner: "worker-1", encoderLeaseUntil: new Date(instant.getTime() + 30_000) };
const station = { id: "station-1", organisationId: "org-1", productFamily: "ONLINE", streamConfig: { ...lease } };
const channel = { id: "channel-1", stationId: station.id, organisationId: station.organisationId };
const policy = { id: "policy-1", rightsUse: "ONLINE_RADIO", territory: "MT", sourceScopes: ["SUBSCRIBER_LIBRARY"] };
const rotation = { ready: true, station, channel, policy, mode: { id: "mode-1" }, fingerprint: "rotation-v1" };
const entitlements = { onlineRadioEnabled: true, studioProEnabled: true, licensedMusicCatalogueLevel: "NONE" };
const session = { id: "session-1", organisationId: station.organisationId, channelId: channel.id, productFamily: "ONLINE", status: "ACTIVE", mode: "MANUAL", fallbackAutoDjId: policy.id, revision: 1 };
const item = { id: "item-1", sessionId: session.id, organisationId: station.organisationId, mediaAssetId: "asset-1", area: "LIVE", status: "READY", rightsReady: true, durationMs: 60_000, cueInMs: 0, cueOutMs: null, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, updatedAt: instant };
const asset = { id: "asset-1", organisationId: station.organisationId, status: "READY", mediaType: "AUDIO", libraryType: "ORGANISATION_AUDIO", durationSeconds: 60, storageKey: "private/asset.mp3" };
const authority = { complete: true, organisationId: station.organisationId, channelId: channel.id, capturedAt: instant, coversUntil: new Date(instant.getTime() + 60_000), candidates: [], requiredInsertions: [] };

function fixture(overrides = {}) {
  const calls = [];
  const database = {
    stationStreamConfig: { findUnique: async (query) => { calls.push(["lease", query]); return overrides.lease ?? lease; } },
    studioPlayoutSession: { findMany: async (query) => { calls.push(["sessions", query]); return overrides.sessions ?? [session]; } },
    studioPlayoutItem: { findMany: async (query) => { calls.push(["items", query]); return overrides.items ?? [item]; } },
    mediaAsset: { findFirst: async (query) => { calls.push(["asset", query]); return overrides.asset === undefined ? asset : overrides.asset; } }
  };
  return { database, calls, options: {
    rotation: overrides.rotation ?? rotation, entitlements: overrides.entitlements ?? entitlements,
    workerOwner: "worker-1", instant,
    authorityLoader: async (_, scope) => { calls.push(["authority", scope]); return overrides.authority ?? authority; }
  } };
}

test("shadow reads a scoped lease, session, future item and asset without changing output", async () => {
  const { database, options, calls } = fixture();
  const result = await inspectStudioOnlineHandoff(database, options);
  assert.deepEqual(result, { ready: true, reason: "SHADOW_ELIGIBLE_NOT_ON_AIR" });
  assert.deepEqual(calls.map(([name]) => name), ["lease", "sessions", "items", "asset", "authority"]);
  assert.equal(calls[0][1].where.stationId, station.id);
  assert.deepEqual(calls[1][1].where, { organisationId: station.organisationId, channelId: channel.id, productFamily: "ONLINE", status: "ACTIVE", mode: "MANUAL" });
  assert.equal(calls[2][1].where.sessionId, session.id);
  assert.equal(calls[3][1].where.id, item.mediaAssetId);
  assert.equal(calls[4][1].durationMs, 60_000);
  assert.equal("decision" in result, false);
  assert.equal("itemId" in result, false);
});

test("missing and ambiguous sessions, stale lease and wrong tenant fail closed", async () => {
  for (const [overrides, reason] of [
    [{ sessions: [] }, "SHADOW_NO_MANUAL_SESSION"],
    [{ sessions: [session, { ...session, id: "session-2" }] }, "SHADOW_SESSIONS_AMBIGUOUS"],
    [{ lease: { ...lease, encoderLeaseOwner: "worker-2" } }, "SHADOW_LEASE_UNAVAILABLE"],
    [{ lease: { ...lease, encoderLeaseUntil: new Date(instant.getTime() - 1) } }, "SHADOW_LEASE_UNAVAILABLE"],
    [{ rotation: { ...rotation, channel: { ...channel, organisationId: "other" } } }, "SHADOW_CHANNEL_UNAVAILABLE"],
    [{ items: [] }, "SHADOW_QUEUE_EMPTY"],
    [{ asset: null }, "SHADOW_ASSET_UNAVAILABLE"]
  ]) {
    const { database, options } = fixture(overrides);
    assert.equal((await inspectStudioOnlineHandoff(database, options)).reason, reason);
  }
});

test("authority and rights blockers remain diagnostic only; query failures do not escape", async () => {
  const blocked = fixture({ authority: { ...authority, complete: false } });
  assert.deepEqual(await inspectStudioOnlineHandoff(blocked.database, blocked.options), { ready: false, reason: "AUTHORITATIVE_SCHEDULE_UNAVAILABLE" });
  const wrongTenant = fixture({ asset: { ...asset, organisationId: "other" } });
  assert.equal((await inspectStudioOnlineHandoff(wrongTenant.database, wrongTenant.options)).reason, "RIGHTS_NOT_CURRENT");
  const failed = fixture();
  failed.database.studioPlayoutSession.findMany = async () => { throw new Error("private database error"); };
  assert.deepEqual(await inspectStudioOnlineHandoff(failed.database, failed.options), { ready: false, reason: "SHADOW_CHECK_FAILED" });
});

test("worker shadow is opt-in, never invokes the prepared-audio transport and keeps Manual commands guarded", async () => {
  const [worker, playout] = await Promise.all([
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/studio-playout.mjs", import.meta.url), "utf8")
  ]);
  assert.match(worker, /RUVANAS_STUDIO_HANDOFF_SHADOW === "1"/);
  assert.match(worker, /inspectStudioOnlineHandoff/);
  assert.doesNotMatch(worker, /pushPreparedStudioAudio|studio-encoder-transport/);
  assert.match(playout, /connected: false/);
});
