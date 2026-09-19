import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadStudioOnlineAuthority } from "../lib/studio-online-authority.mjs";
import { planStudioOnlineOutput } from "../lib/studio-online-output-plan.mjs";

const instant = new Date("2026-09-21T12:00:00Z");
const scope = { organisationId: "org-1", stationId: "station-1", channelId: "channel-1", durationMs: 60_000, instant };

function fakeDatabase(rows = {}) {
  const calls = [];
  const method = (model, action) => async (input) => {
    calls.push({ model, action, input });
    if (rows.throwOn === model) throw new Error("database unavailable");
    if (model === "channel" && !(model in rows)) return { id: scope.channelId };
    return rows[model] ?? null;
  };
  const tx = Object.fromEntries([
    "channel", "programmeSchedule", "campaign", "radioAdvertisingPolicy",
    "playoutIntent", "channelAssignment", "radioSyndicationAgreement", "liveFailoverPolicy", "externalLiveSource", "liveStudioSession"
  ].map((model) => [model, { findFirst: method(model, "findFirst"), findUnique: method(model, "findUnique") }]));
  return { calls, $transaction: (callback, options) => { calls.push({ transaction: options }); return callback(tx); } };
}

test("station authority is complete only after scoped read-only checks", async () => {
  const db = fakeDatabase();
  const result = await loadStudioOnlineAuthority(db, scope);
  assert.equal(result.complete, true);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.requiredInsertions, []);
  assert.equal(result.coversUntil.getTime(), instant.getTime() + scope.durationMs);
  assert.deepEqual(db.calls[0], { transaction: { isolationLevel: "RepeatableRead" } });
  assert.deepEqual(db.calls[1].input.where, { id: scope.channelId, organisationId: scope.organisationId, stationId: scope.stationId, status: "ACTIVE" });
  assert.equal(db.calls.filter((call) => call.model).length, 10);
  const campaignQuery = db.calls.find((call) => call.model === "campaign").input.where;
  assert.deepEqual(campaignQuery.targets.some.OR, [
    { targetType: "STATION", stationId: scope.stationId }, { targetType: "CHANNEL", channelId: scope.channelId }
  ]);
});

test("scheduled programmes are represented as protected candidates, including overnight slots", async () => {
  const oneOff = fakeDatabase({ programmeSchedule: { id: "schedule-1", timezone: "UTC", versions: [{ id: "version-1", version: 2, items: [{
    id: "item-1", position: 0, label: "Scheduled show", recurrence: "ONE_OFF", sourceType: "MUSIC_MODE",
    startsAt: new Date(instant.getTime() + 30_000), durationMinutes: 30, priority: 0, musicModeId: "mode-1"
  }] }] } });
  const upcoming = await loadStudioOnlineAuthority(oneOff, scope);
  assert.equal(upcoming.complete, true);
  assert.equal(upcoming.candidates[0].sourceType, "PROGRAMME_SCHEDULE");
  assert.equal(upcoming.candidates[0].sourceId, "item-1");
  assert.equal(upcoming.candidates[0].validFrom.getTime(), instant.getTime() + 30_000);

  const afterMidnight = new Date("2026-09-21T00:30:00Z");
  const overnight = fakeDatabase({ programmeSchedule: { id: "schedule-2", timezone: "UTC", versions: [{ id: "version-2", version: 1, items: [{
    id: "item-2", position: 0, label: "Overnight show", recurrence: "WEEKLY", sourceType: "MUSIC_MODE",
    weekday: 0, startMinute: 23 * 60, durationMinutes: 120, priority: 0, musicModeId: "mode-2"
  }] }] } });
  const active = await loadStudioOnlineAuthority(overnight, { ...scope, instant: afterMidnight });
  assert.equal(active.complete, true);
  assert.equal(active.candidates[0].sourceId, "item-2");
  assert.ok(active.candidates[0].validFrom < afterMidnight && active.candidates[0].validUntil > afterMidnight);
});

test("uncompiled campaigns, live failover and database failures block the snapshot", async () => {
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ campaign: { id: "campaign-1" } }), scope)).reason, "CAMPAIGN_OUTPUT_NOT_COMPILED");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ liveFailoverPolicy: { enabled: true } }), scope)).reason, "LIVE_FAILOVER_OUTPUT_NOT_COMPILED");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ externalLiveSource: { id: "source-1" } }), scope)).reason, "EXTERNAL_LIVE_OUTPUT_NOT_COMPILED");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ radioSyndicationAgreement: { id: "agreement-1" } }), scope)).reason, "SYNDICATED_OUTPUT_NOT_COMPILED");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ throwOn: "programmeSchedule" }), scope)).reason, "AUTHORITY_SNAPSHOT_FAILED");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ channel: null }), scope)).reason, "ONLINE_CHANNEL_NOT_ACTIVE");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase({ programmeSchedule: { id: "bad", timezone: "UTC", versions: [{ id: "v", version: 1, items: [{ id: "bad-item", recurrence: "ONE_OFF", startsAt: "not-a-date", durationMinutes: 10, priority: 0, sourceType: "MUSIC_MODE" }] }] } }), scope)).reason, "PUBLISHED_PROGRAMME_INVALID");
  assert.equal((await loadStudioOnlineAuthority(fakeDatabase(), { ...scope, durationMs: 0 })).reason, "INVALID_AUTHORITY_SCOPE");
});

test("a station snapshot feeds the handoff planner without bypassing a future programme", async () => {
  const channel = { id: scope.channelId, stationId: scope.stationId, organisationId: scope.organisationId };
  const policy = { id: "policy-1", rightsUse: "ONLINE_RADIO", sourceScopes: [] };
  const station = { id: scope.stationId, organisationId: scope.organisationId, productFamily: "ONLINE", streamConfig: { encoderLeaseOwner: "worker-1", encoderLeaseUntil: new Date(instant.getTime() + 30_000) } };
  const session = { id: "session-1", organisationId: scope.organisationId, channelId: scope.channelId, productFamily: "ONLINE", status: "ACTIVE", mode: "MANUAL", fallbackAutoDjId: policy.id, revision: 1 };
  const asset = { id: "asset-1", organisationId: scope.organisationId, status: "READY", mediaType: "AUDIO", durationSeconds: 60, storageKey: "protected/audio.mp3" };
  const item = { id: "item-1", sessionId: session.id, organisationId: scope.organisationId, mediaAssetId: asset.id, area: "LIVE", status: "READY", rightsReady: true, durationMs: 60_000 };
  const rotation = { ready: true, station, channel, policy, mode: { id: "mode-1" } };
  const entitlements = { onlineRadioEnabled: true, studioProEnabled: true };
  const input = { rotation, entitlements, session, item, asset, workerOwner: "worker-1", instant };
  const clear = await loadStudioOnlineAuthority(fakeDatabase(), scope);
  assert.equal(planStudioOnlineOutput({ ...input, authority: clear }).ready, true);
  const scheduled = await loadStudioOnlineAuthority(fakeDatabase({ programmeSchedule: { id: "schedule-1", timezone: "UTC", versions: [{ id: "version-1", version: 1, items: [{
    id: "show-1", position: 0, label: "Next show", recurrence: "ONE_OFF", sourceType: "MUSIC_MODE",
    startsAt: new Date(instant.getTime() + 30_000), durationMinutes: 30, priority: 0, musicModeId: "mode-2"
  }] }] } }), scope);
  assert.equal(planStudioOnlineOutput({ ...input, authority: scheduled }).reason, "PROTECTED_SOURCE_DURING_AUDIO");
});

test("the live worker still cannot infer queue playback from an authority snapshot", async () => {
  const [worker, guard] = await Promise.all([
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/studio-playout.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(worker, /loadStudioOnlineAuthority/);
  assert.match(guard, /connected: false/);
});
