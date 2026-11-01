import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";
import { createSubscriberTestPlanSnapshot } from "../lib/subscriber-test-plan.mjs";
import { RETAIL_PILOT_ACCESS as P } from "../lib/retail-stream-pilot-access.mjs";
import { retailSourceFingerprint } from "../lib/retail-stream-playout-policy.mjs";
import { RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { loadRetailTestPlayerByTokenHash, loadRetailTestPlayerForEnrolment, retailTestStreamManifest } from "../lib/retail-test-player-access.mjs";
import { enrolPlayerCode } from "../lib/player-enrolment.mjs";
import { recordRetailStreamEvidence, readRetailStreamEvidence, normalizeRetailStreamEvidence } from "../lib/retail-test-stream-evidence.mjs";
import { subscriberPlayerReadiness } from "../lib/subscriber-player-readiness.mjs";

const NOW = new Date("2026-11-01T12:00:00Z"), END = new Date("2026-11-23T12:00:00Z"), HASH = "aa".repeat(32), CODE = "bb".repeat(32);
const copy = structuredClone;
function fixture() {
  const subscription = { id: "retail-sub", organisationId: P.organisationId, planId: "preview-plan", status: "TRIAL",
    currentPeriodEnd: END, billingContract: null, complimentaryAccessActive: false, schoolPublicPublishingEnabled: false,
    retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]),
    plan: { id: "preview-plan", ...PREVIEW_TESTER_PLAN } };
  subscription.subscriberTestPlanSnapshot = createSubscriberTestPlanSnapshot({
    plan: { ...PUBLIC_PLAN_CATALOGUE.find(p => p.code === "RETAIL_ENTERPRISE"), id: "enterprise-plan" },
    userId: "retail-user", organisationId: P.organisationId, basePlanId: subscription.planId, pillars: ["RETAIL"], expiresAt: END, now: NOW });
  const organisation = { id: P.organisationId, enterpriseSecurityPolicy: null, subscription };
  const user = { id: "retail-user", email: P.email, role: "OWNER", privatePreviewAccess: { userId: "retail-user",
    organisationId: P.organisationId, subscriberTestingEnabled: true, enabled: true, passwordEnabled: true, expiresAt: END, pillars: ["RETAIL"] },
    memberships: [{ organisationId: P.organisationId, role: "OWNER", organisation }] };
  const source = { stationId: STATION, providerKey: "CENTOVA_CAST", outputCodec: "MP3", serverHost: P.host,
    serverPort: P.port, sourcePort: P.port, centovaUsername: P.account, sourceUsername: null, streamUrl: P.listenerUrl,
    bitrateKbps: 128, sourcePasswordEncrypted: "synthetic-ciphertext", outboundAutoDjEnabled: false, probeEnabled: false };
  const station = { id: STATION, organisationId: P.organisationId,
    slug: `retail-shared-${createHash("sha256").update(P.organisationId).digest("hex")}`, productFamily: "RETAIL", status: "DRAFT",
    publicPlayerEnabled: false, stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", listenerLimit: 10, streamConfig: source };
  const command = { kind: P.kind, action: "APPROVE", id: "approval", organisationId: P.organisationId,
    stationId: STATION, testerUserId: user.id, actorUserId: "owner", issuedAt: NOW.toISOString(), expiresAt: END.toISOString(),
    territory: P.territory, catalogueLevel: P.catalogueLevel, sourceScopes: [...P.sourceScopes], sourceFingerprint: retailSourceFingerprint(source) };
  const env = { SECRET_ENCRYPTION_KEY: "11".repeat(32), RUVANAS_PRIVATE_PREVIEW_ENABLED: "1" };
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
  const derived = createHmac("sha256", Buffer.from(env.SECRET_ENCRYPTION_KEY, "hex")).update("ruvanas/retail-pilot-access/v1").digest();
  const grant = { id: `retail-pilot-access:${STATION}`, organisationId: P.organisationId, entityType: "RetailPilotAccess", entityId: STATION,
    details: { command, signature: createHmac("sha256", derived).update(canonical(command)).digest("hex") } };
  const player = { id: "retail-player", name: "Shop", organisationId: P.organisationId, organisation, zoneId: "zone", status: "ONLINE",
    enrolledAt: NOW, lastHeartbeatAt: NOW, sessionTokenHash: HASH, enrolmentTokenHash: CODE, enrolmentExpiresAt: END,
    retiredAt: null, sessionRevokedAt: null,
    zone: { id: "zone", status: "ACTIVE", locationId: "location", location: { id: "location", status: "ACTIVE", organisationId: P.organisationId } } };
  const state = { user, station, player, memberCount: 1, ownerRole: "SUPER_ADMIN", assignments: [], audits: [grant], mutations: [],
    channels: [{ id: "retail-channel", name: "Shared", organisationId: P.organisationId, stationId: STATION, status: "DRAFT", musicRightsUse: "RETAIL_RADIO" }] };
  const db = {
    user: { findUnique: async args => copy(args.where.email === P.email ? state.user : { id: "owner", role: state.ownerRole }) },
    organisationMember: { count: async () => state.memberCount }, station: { findUnique: async () => copy(state.station) },
    channel: { findMany: async () => copy(state.channels) }, channelAssignment: { findMany: async () => copy(state.assignments) },
    player: { findUnique: async args => Object.entries(args.where).every(([k, v]) => state.player[k] === v) ? copy(state.player) : null,
      updateMany: async args => { const match = state.player.enrolmentTokenHash === args.where.enrolmentTokenHash;
        if (!match) return { count: 0 }; state.mutations.push(copy(args.data)); Object.assign(state.player, copy(args.data)); return { count: 1 }; } },
    auditLog: { findUnique: async args => copy(state.audits.find(row => row.id === args.where.id) || null),
      create: async args => { state.audits.push(copy(args.data)); },
      upsert: async args => { const row = state.audits.find(row => row.id === args.where.id); if (row) Object.assign(row, copy(args.update)); else state.audits.push(copy(args.create)); } }
  };
  let tail = Promise.resolve();
  db.$transaction = op => { const result = tail.then(() => op(db)); tail = result.catch(() => {}); return result; };
  return { db, state, env, options: { now: NOW, env }, access: () => loadRetailTestPlayerByTokenHash(db, HASH, { now: NOW, env }) };
}

test("only freshly authorized Test Retail device receives a stream-only view and existing listener cap", async () => {
  const f = fixture(), before = copy(f.state), player = await f.access();
  assert.ok(player); assert.equal(player.subscriberTestListenerLimit, 10);
  assert.deepEqual(player.subscriberTestStream, { kind: "RETAIL_SHARED_STREAM", stationId: STATION, channelId: "retail-channel",
    name: "Retail radio", streamUrl: P.listenerUrl, expiresAt: END.toISOString() });
  const manifest = retailTestStreamManifest(player, NOW);
  assert.deepEqual(manifest.playlist, []); assert.equal(manifest.live, null); assert.equal(manifest.proofOfPlayEnabled, false);
  assert.doesNotMatch(JSON.stringify(manifest), /synthetic-ciphertext|sourcePassword|storageKey|sessionToken/);
  assert.deepEqual(f.state, before); assert.equal(await loadRetailTestPlayerByTokenHash(f.db, "not-a-token", f.options), null);
});

test("tenant, token, device, own active location, signed approval and grant revocation all fail closed", async () => {
  const mutations = [s => s.player.organisationId = "foreign", s => s.player.sessionTokenHash = "cc".repeat(32),
    s => s.player.zone.location.organisationId = "foreign", s => s.player.zone.location.status = "CLOSED",
    s => s.player.zone.status = "PAUSED", s => s.player.zone.location.correctionsFacility = { id: "facility" },
    s => s.player.status = "DISABLED", s => s.player.retiredAt = NOW, s => s.player.sessionRevokedAt = NOW,
    s => s.user.privatePreviewAccess.subscriberTestingEnabled = false, s => s.user.privatePreviewAccess.enabled = false,
    s => s.user.privatePreviewAccess.expiresAt = NOW, s => s.user.email = "radio@manuelchircop.com",
    s => s.user.memberships[0].role = "MANAGER", s => s.memberCount = 2, s => s.ownerRole = "OWNER",
    s => s.audits[0].details.signature = "00".repeat(32), s => s.audits[0].details.command.action = "REVOKE",
    s => s.station.streamConfig.streamUrl = "https://other.example/stream", s => s.station.streamConfig.sourcePort = 8282,
    s => s.channels.push({ ...s.channels[0], id: "second" }), s => s.channels[0].organisationId = "foreign",
    s => s.assignments.push({ channelId: "other-channel" })];
  for (const mutate of mutations) { const f = fixture(); mutate(f.state); assert.equal(await f.access(), null, String(mutate)); assert.equal(f.state.mutations.length, 0); }
  const f = fixture(); assert.equal(await loadRetailTestPlayerByTokenHash(f.db, HASH, { ...f.options, now: END }), null);
});

test("one-time Retail enrolment is atomic, does not claim playback, and preview rejects other products", async () => {
  const f = fixture(); f.state.player.sessionTokenHash = null; f.state.player.enrolledAt = null; f.state.player.status = "PENDING_ENROLMENT";
  assert.ok(await loadRetailTestPlayerForEnrolment(f.db, CODE, f.options));
  const results = await Promise.all(["cc", "dd"].map(value => enrolPlayerCode(f.db, { ...f.options,
    enrolmentTokenHash: CODE, sessionTokenHash: value.repeat(32) })));
  assert.equal(results.filter(Boolean).length, 1); assert.equal(f.state.mutations.length, 1);
  assert.equal(f.state.player.status, "OFFLINE"); assert.equal(f.state.player.lastHeartbeatAt, null);
  assert.equal(f.state.player.enrolmentTokenHash, null); assert.equal(f.state.audits.at(-1).details.playbackConfirmed, false);
  const foreign = fixture(); foreign.state.player.organisationId = "other";
  assert.equal(await enrolPlayerCode(foreign.db, { ...foreign.options, enrolmentTokenHash: CODE, sessionTokenHash: HASH }), null);
  assert.equal(foreign.state.mutations.length, 0);
});

test("stream evidence is bounded device progress, never per-song proof, and stale/paused evidence is not ready", async () => {
  const f = fixture(), player = await f.access();
  const report = (now, positionSeconds, state = "PLAYING") => recordRetailStreamEvidence(f.db, { player, now,
    input: { state, positionSeconds, observedAt: now.toISOString() } });
  assert.equal((await report(NOW, 1)).progressObserved, false);
  const next = new Date(NOW.getTime() + 15000);
  assert.equal((await report(next, 16)).progressObserved, true);
  const row = f.state.audits.at(-1), evidence = readRetailStreamEvidence(row, player, next);
  const readyPlayer = { ...player, lastHeartbeatAt: next, subscriberTestStreamEvidence: evidence,
    heartbeatSamples: [{ sourceStatus: "CONNECTED", observedAt: next }] };
  assert.equal(subscriberPlayerReadiness(readyPlayer, next).code, "STREAM_PLAYING");
  assert.equal(subscriberPlayerReadiness(readyPlayer, next).latestPlayback, null);
  assert.equal(subscriberPlayerReadiness(readyPlayer, new Date(next.getTime() + 46000)).ready, false);
  assert.equal(readRetailStreamEvidence(row, { ...player, enrolledAt: next }, next), null);
  assert.equal(readRetailStreamEvidence({ ...row, organisationId: "foreign" }, player, next), null);
  const paused = new Date(next.getTime() + 1000); await report(paused, 17, "PAUSED");
  readyPlayer.subscriberTestStreamEvidence = readRetailStreamEvidence(f.state.audits.at(-1), player, paused);
  assert.equal(subscriberPlayerReadiness(readyPlayer, paused).ready, false);
  assert.equal(f.state.audits.filter(row => row.entityType === "RetailPlayerStreamEvidence").length, 1);
  for (const input of [{ state: "PLAYING", positionSeconds: Infinity, observedAt: NOW.toISOString() },
    { state: "PLAYING", positionSeconds: 1, observedAt: END.toISOString() },
    { state: "PLAYING", positionSeconds: 1, observedAt: NOW.toISOString(), trackId: "private" }])
    assert.equal(normalizeRetailStreamEvidence(input, NOW), null);
});
