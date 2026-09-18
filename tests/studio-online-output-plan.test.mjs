import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PLAYOUT_SOURCE_PRIORITIES } from "../lib/playout-resolver.mjs";
import { planStudioOnlineOutput } from "../lib/studio-online-output-plan.mjs";

const instant = new Date("2026-09-18T12:00:00Z");
const station = { id: "station-1", organisationId: "org-1", productFamily: "ONLINE", streamConfig: { encoderLeaseOwner: "worker-1", encoderLeaseUntil: new Date(instant.getTime() + 30_000) } };
const channel = { id: "channel-1", stationId: station.id, organisationId: station.organisationId };
const policy = { id: "policy-1", rightsUse: "ONLINE_RADIO", territory: "MT", sourceScopes: ["SUBSCRIBER_LIBRARY"] };
const rotation = { ready: true, station, channel, policy, mode: { id: "autodj-1" }, fingerprint: "rotation-v1" };
const entitlements = { onlineRadioEnabled: true, studioProEnabled: true, licensedMusicCatalogueLevel: "NONE" };
const session = { id: "session-1", organisationId: station.organisationId, channelId: channel.id, productFamily: "ONLINE", status: "ACTIVE", mode: "MANUAL", fallbackAutoDjId: policy.id, revision: 3 };
const asset = { id: "asset-1", organisationId: station.organisationId, status: "READY", mediaType: "AUDIO", libraryType: "ORGANISATION_AUDIO", durationSeconds: 60, storageKey: "private/asset.mp3" };
const item = { id: "item-1", sessionId: session.id, organisationId: station.organisationId, mediaAssetId: asset.id, area: "LIVE", status: "READY", rightsReady: true, durationMs: 60_000, cueInMs: 0, cueOutMs: null, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, updatedAt: instant };
const authority = { complete: true, organisationId: station.organisationId, channelId: channel.id, capturedAt: instant, coversUntil: new Date(instant.getTime() + 60_000), candidates: [], requiredInsertions: [] };
const plan = (overrides = {}) => planStudioOnlineOutput({ rotation, entitlements, session, item, asset, authority, workerOwner: "worker-1", instant, ...overrides });

test("Manual output is only a dry-run decision above AutoDJ and below protected programming", () => {
  const result = plan();
  assert.equal(result.ready, true);
  assert.equal(result.reason, "MANUAL_MAY_BE_PREPARED");
  assert.equal(result.decision.sourceType, "STUDIO_MANUAL");
  assert.equal(result.decision.priority, PLAYOUT_SOURCE_PRIORITIES.STUDIO_MANUAL);
  assert.deepEqual(result.decision.fallbackChain.map((entry) => entry.sourceType), ["STUDIO_MANUAL", "DEFAULT_AUTODJ"]);
  const protectedPlan = plan({ authority: { ...authority, candidates: [{ sourceType: "PROGRAMME_SCHEDULE", sourceId: "scheduled-show", organisationId: station.organisationId, channelId: channel.id, validFrom: instant, validUntil: new Date(instant.getTime() + 60_000), available: true }] } });
  assert.equal(protectedPlan.ready, false);
  assert.equal(protectedPlan.reason, "HIGHER_PRIORITY_SOURCE");
  assert.equal(protectedPlan.decision.sourceType, "PROGRAMME_SCHEDULE");
});

test("tenant, channel, entitlement, fallback and stale authority all fail closed", () => {
  assert.equal(plan({ session: { ...session, organisationId: "org-2" } }).reason, "MANUAL_SESSION_NOT_ACTIVE");
  assert.equal(plan({ session: { ...session, channelId: "channel-2" } }).reason, "MANUAL_SESSION_NOT_ACTIVE");
  assert.equal(plan({ entitlements: { ...entitlements, studioProEnabled: false } }).reason, "SERVICE_OR_STUDIO_PRO_INACTIVE");
  assert.equal(plan({ rotation: { ...rotation, policy: { ...policy, rightsUse: "RETAIL_RADIO" } } }).reason, "WRONG_PRODUCT_RIGHTS_USE");
  assert.equal(plan({ rotation: { ...rotation, ready: false } }).reason, "AUTODJ_FALLBACK_UNAVAILABLE");
  assert.equal(plan({ workerOwner: "worker-2" }).reason, "ENCODER_LEASE_UNAVAILABLE");
  assert.equal(plan({ authority: { ...authority, capturedAt: new Date(instant.getTime() - 11_000) } }).reason, "AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
  assert.equal(plan({ authority: { ...authority, complete: false } }).reason, "AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
  assert.equal(plan({ authority: { ...authority, coversUntil: new Date(instant.getTime() + 30_000) } }).reason, "AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
  assert.equal(plan({ authority: { ...authority, candidates: [{ sourceType: "EMERGENCY_OVERRIDE", sourceId: "forged", priority: 1 }] } }).reason, "AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
  assert.equal(plan({ authority: { ...authority, candidates: [{ sourceType: "DEFAULT_AUTODJ", sourceId: "forged" }] } }).reason, "AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
});

test("required insertions, unsupported mix and expiring rights prevent handoff", () => {
  assert.equal(plan({ authority: { ...authority, requiredInsertions: [{ scheduleItemId: "ad", plannedStart: new Date(instant.getTime() + 30_000) }] } }).reason, "REQUIRED_INSERTION_PENDING");
  assert.equal(plan({ authority: { ...authority, candidates: [{ sourceType: "PROGRAMME_SCHEDULE", sourceId: "next-show", validFrom: new Date(instant.getTime() + 30_000), validUntil: new Date(instant.getTime() + 90_000) }] } }).reason, "PROTECTED_SOURCE_DURING_AUDIO");
  assert.equal(plan({ item: { ...item, fadeOutMs: 1000 } }).reason, "STUDIO_MIX_NOT_SUPPORTED_BY_ENCODER");
  const music = { ...asset, mediaType: "MUSIC", libraryType: "ORGANISATION_MUSIC", track: { status: "READY", licenceExpiresAt: new Date(instant.getTime() + 30_000) } };
  assert.equal(plan({ asset: music }).reason, "RIGHTS_EXPIRE_DURING_AUDIO");
  assert.equal(plan({ asset: { ...music, track: { ...music.track, licenceExpiresAt: null, rightsReviewStatus: "REJECTED" } } }).reason, "RIGHTS_NOT_CURRENT");
});

test("music needs current Online Radio rights and its approved source scope", () => {
  const music = { ...asset, mediaType: "MUSIC", libraryType: "ORGANISATION_MUSIC", track: {
    status: "READY", rightsReviewStatus: "APPROVED", rightsConfirmedAt: instant, rightsHolder: "Owner", rightsReference: "test-evidence", rightsBasis: "OWNED", permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"], licenceStartsAt: null, licenceExpiresAt: null
  } };
  assert.equal(plan({ asset: music }).ready, true);
  assert.equal(plan({ asset: music, rotation: { ...rotation, policy: { ...policy, sourceScopes: ["RUVANAS_CORE"] } } }).reason, "SOURCE_SCOPE_NOT_ALLOWED");
  assert.equal(plan({ asset: { ...music, track: { ...music.track, permittedUses: ["RETAIL_RADIO"] } } }).reason, "RIGHTS_NOT_CURRENT");
});

test("plan cannot mark actual output or unlock manual controls", async () => {
  const result = plan();
  assert.equal(result.decision.selectedPayload?.itemId, item.id);
  assert.equal("listenerVerified" in result, false);
  const [worker, playout] = await Promise.all([
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/studio-playout.mjs", import.meta.url), "utf8")
  ]);
  assert.match(worker, /inspectStudioOnlineHandoff/);
  assert.doesNotMatch(worker, /pushPreparedStudioAudio|studio-encoder-transport/);
  assert.match(playout, /connected: false/);
});
