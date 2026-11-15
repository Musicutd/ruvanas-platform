import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN } from "../lib/private-preview-account-policy.mjs";
import { TEST_RADIO_CONTINUOUS as P } from "../lib/test-radio-continuous-policy.mjs";
import { CONTINUOUS_CONTROL_ID, CONTINUOUS_OBSERVATION_ID, startContinuousRadio, stopContinuousRadio,
  loadAuthorizedContinuousRadio, claimContinuousRadioLease, renewContinuousRadioLease, releaseContinuousRadioLease,
  reserveContinuousRadioBytes, recordContinuousRadioObservation, continuousRadioDashboard } from "../lib/test-radio-continuous-service.mjs";

const NOW = new Date("2026-10-23T00:00:00Z"), BEFORE = new Date("2026-10-20T00:00:00Z");
const ORG = "cmtestorganisation00001", OWNER = "cmtestowner00000000001";
const ENV = { SECRET_ENCRYPTION_KEY: "ad".repeat(32), RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED: "true" };
const clone = value => structuredClone(value);
function track(index = 1) {
  const assetId = `cmtestasset${String(index).padStart(10, "0")}`;
  return { id: `cmtesttrack${String(index).padStart(10, "0")}`, mediaAssetId: assetId, title: `Track ${index}`, artist: "Artist",
    status: "READY", catalogueProvider: null, minimumCatalogueLevel: "FOCUSED", rightsHolder: "Owner", rightsReference: "Direct reviewed permission",
    rightsBasis: "OTHER", rightsReviewStatus: "APPROVED", rightsReviewedAt: BEFORE, rightsReviewedById: OWNER,
    rightsConfirmedAt: BEFORE, rightsConfirmedById: OWNER, permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
    licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-01T00:00:00Z"), updatedAt: BEFORE, distributorItems: [],
    mediaAsset: { id: assetId, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY",
      licensedCatalogue: true, storageKey: `catalogue/music/${index.toString(16).padStart(64, "0")}.mp3`, sizeBytes: 1000000n,
      durationSeconds: 180, mimeType: "audio/mpeg", updatedAt: BEFORE, genres: [{ mediaGenre: genre() }] } };
}
function genre() { return { id: "cmtestgenrepop00000001", slug: "pop", name: "Pop", active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" }; }
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(condition => matches(row, condition));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lt" in value) return row[key] != null && row[key] < value.lt;
      if ("gt" in value) return row[key] != null && row[key] > value.gt;
      if ("in" in value) return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
}
function fixture() {
  const data = { audits: new Map(), conflict: false, owner: { id: OWNER, role: "SUPER_ADMIN" }, tracks: [track(1), track(2), track(3)],
    config: { stationId: P.stationId, providerKey: "CENTOVA_CAST", streamUrl: P.listenerUrl, serverHost: P.host, serverPort: P.port,
      sourcePort: P.port, sourceUsername: null, centovaUsername: P.account, bitrateKbps: 128,
      sourcePasswordEncrypted: "test-only-ciphertext", outboundAutoDjEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null } };
  data.station = { id: P.stationId, organisationId: ORG, productFamily: "ONLINE", status: "DRAFT", publicPlayerEnabled: false,
    stationWebsiteEnabled: false, organisation: { id: ORG, subscription: { organisationId: ORG, plan: clone(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN),
      status: "TRIAL", onlineRadioEnabled: true, currentPeriodEnd: new Date("2026-11-23T00:00:00Z"), billingContract: null } } };
  const actorSession = { id: "cmownersession00000001", userId: OWNER, user: { id: OWNER, role: "SUPER_ADMIN", privatePreviewAccess: null },
    authMethod: "PASSWORD", activeOrganisationId: null, activeOrganisation: null, createdAt: BEFORE, lastSeenAt: NOW,
    revokedAt: null, expiresAt: new Date(NOW.getTime() + 3600000) };
  let next = 0, tail = Promise.resolve();
  const writes = [];
  const db = {
    auditLog: {
      findUnique: async ({ where }) => clone(data.audits.get(where.id) || null),
      upsert: async ({ where, create, update }) => { const row = data.audits.has(where.id) ? { ...data.audits.get(where.id), ...clone(update) } : clone(create);
        data.audits.set(where.id, row); writes.push(row); return clone(row); },
      create: async ({ data: entry }) => { const row = { id: `audit-${++next}`, ...clone(entry) }; data.audits.set(row.id, row); writes.push(row); return clone(row); },
    },
    station: { findUnique: async ({ where }) => where.id === P.stationId ? clone({ ...data.station, streamConfig: data.config }) : null },
    stationStreamConfig: {
      findUnique: async ({ where }) => where.stationId === P.stationId ? clone(data.config) : null,
      updateMany: async ({ where, data: change }) => { if (!matches(data.config, where)) return { count: 0 };
        Object.assign(data.config, clone(change)); writes.push({ stationId: where.stationId, change }); return { count: 1 }; },
    },
    mediaGenre: { findMany: async () => [genre()] },
    track: { findMany: async () => clone(data.tracks) },
    user: { findUnique: async ({ where }) => where.id === data.owner?.id ? clone(data.owner) : null },
    onlineRadioCatalogueTest: { findFirst: async () => data.conflict ? { id: "active-test" } : null },
  };
  db.$transaction = async action => {
    let unlock; const gate = new Promise(resolve => { unlock = resolve; }), waiting = tail; tail = waiting.then(() => gate);
    await waiting;
    try { return await action(db); } finally { unlock(); }
  };
  const options = { actorSession, now: NOW, env: ENV, publicExposureAccepted: true, monthlyBudgetUsd: 15 };
  return { db, data, writes, actorSession, options };
}
async function running(f) {
  const grant = await startContinuousRadio(f.db, f.options);
  const lease = await claimContinuousRadioLease(f.db, { grantId: grant.grantId, workerId: "worker-instance-1", now: NOW, env: ENV });
  return { grantId: grant.grantId, leaseOwner: lease.leaseOwner, now: NOW, env: ENV };
}
test("owner grants continuous playback without mutating ordinary permissions or other stations", async () => {
  const f = fixture();
  const started = await startContinuousRadio(f.db, f.options);
  const loaded = await loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV });
  assert.equal(started.grantId, loaded.grant.id); assert.equal(loaded.tracks.length, 3);
  assert.equal(f.data.config.outboundAutoDjEnabled, false);
  assert.equal(f.data.station.publicPlayerEnabled, false);
  assert.equal(f.data.station.organisation.subscription.plan.code, PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN.code);
  assert.ok(f.writes.every(row => !row.stationId || row.stationId === P.stationId));
  assert.equal((await continuousRadioDashboard(f.db, f.options)).serviceExpiresAt, "2026-11-23T00:00:00.000Z");
  // Explicit ongoing permission does not expire when the issuing browser logs out.
  f.actorSession.revokedAt = NOW;
  assert.equal((await loadAuthorizedContinuousRadio(f.db, { now: new Date(NOW.getTime() + 7200000), env: ENV })).grant.id, started.grantId);
});
test("two-track minimum requires two distinct approved recordings, not duplicate catalogue rows", async () => {
  const f = fixture();
  f.data.tracks = [track(1), track(2)];
  f.data.tracks[1].mediaAssetId = f.data.tracks[0].mediaAssetId;
  f.data.tracks[1].mediaAsset = clone(f.data.tracks[0].mediaAsset);
  await assert.rejects(startContinuousRadio(f.db, f.options), { code: "CONTINUOUS_NO_APPROVED_MUSIC" });
  f.data.tracks[1] = track(2);
  f.data.tracks[1].mediaAsset.storageKey = f.data.tracks[0].mediaAsset.storageKey;
  await assert.rejects(startContinuousRadio(f.db, f.options), { code: "CONTINUOUS_NO_APPROVED_MUSIC" });
  f.data.tracks[1] = track(2);
  assert.equal((await startContinuousRadio(f.db, f.options)).enabled, true);
});
test("start requires exact owner, feature, public exposure, budget and no active timed test", async () => {
  for (const change of [{ publicExposureAccepted: false }, { monthlyBudgetUsd: 16 }]) {
    const f = fixture(); await assert.rejects(startContinuousRadio(f.db, { ...f.options, ...change }), { code: "CONTINUOUS_APPROVAL_REQUIRED" });
  }
  const f = fixture();
  await assert.rejects(startContinuousRadio(f.db, { ...f.options, env: { ...ENV, RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED: "false" } }), { code: "CONTINUOUS_START_DISABLED" });
  await assert.rejects(startContinuousRadio(f.db, { ...f.options, actorSession: { ...f.actorSession, user: { ...f.actorSession.user, role: "OWNER" } } }), { code: "CONTINUOUS_OWNER_REQUIRED" });
  f.data.conflict = true;
  await assert.rejects(startContinuousRadio(f.db, f.options), { code: "CONTINUOUS_TEST_CONFLICT" });
});
test("current rights, owner demotion, service expiry, tampering and source changes fail closed", async () => {
  const f = fixture(); await startContinuousRadio(f.db, f.options);
  f.data.tracks[0].rightsReviewStatus = "REJECTED";
  assert.equal((await loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV })).tracks.length, 2);
  f.data.tracks[1].permittedTerritories = "GB";
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_NO_APPROVED_MUSIC" });
  f.data.owner.role = "OWNER";
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_OWNER_REVOKED" });
  f.data.owner.role = "SUPER_ADMIN"; f.data.config.sourcePasswordEncrypted = "changed-ciphertext";
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_SOURCE_CHANGED" });
  f.data.config.sourcePasswordEncrypted = "test-only-ciphertext"; f.data.station.organisation.subscription.currentPeriodEnd = BEFORE;
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_SERVICE_INACTIVE" });
  f.data.audits.get(CONTINUOUS_CONTROL_ID).details.command.stationId = "another-station";
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_NOT_ENABLED" });
});
test("authenticated Stop still persists when the signing key is unavailable", async () => {
  const f = fixture(), active = await running(f);
  await stopContinuousRadio(f.db, { ...f.options, env: {} });
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_NOT_ENABLED" });
  await releaseContinuousRadioLease(f.db, active);
  assert.equal((await continuousRadioDashboard(f.db, f.options)).status, "STOPPED");
});

test("programme phase requires fresh accepted audio and stale schedule evidence never stops authorised music", async () => {
  const f = fixture(), active = await running(f);
  await recordContinuousRadioObservation(f.db, { ...active, state: "STREAMING", trackId: f.data.tracks[0].id, audioBytesSent: 384,
    phase: "RANDOM" });
  let view = await continuousRadioDashboard(f.db, f.options);
  assert.equal(view.listening.enabled, true); assert.equal(view.listening.phase, "RANDOM"); assert.equal(view.listening.programme, null);
  // No valid signed schedule is present in this fixture. A late observation of
  // a formerly approved programme must not turn into a current programme claim.
  await recordContinuousRadioObservation(f.db, { ...active, state: "STREAMING", trackId: f.data.tracks[0].id, audioBytesSent: 768,
    phase: "SCHEDULED", occurrenceId: "old-occurrence", scheduleRevision: "old-revision" });
  view = await continuousRadioDashboard(f.db, f.options);
  assert.equal(view.listening.enabled, true); assert.equal(view.listening.phase, "UNKNOWN"); assert.equal(view.listening.programme, null);
  const stale = await continuousRadioDashboard(f.db, { ...f.options, now: new Date(NOW.getTime() + 16000) });
  assert.equal(stale.listening.enabled, false); assert.equal(stale.listening.phase, "UNKNOWN");
});
test("atomic leases exclude competing workers, enforce takeover grace and retain unconfirmed shutdown", async () => {
  const f = fixture(), active = await running(f);
  await assert.rejects(claimContinuousRadioLease(f.db, { ...active, workerId: "worker-instance-2" }), { code: "CONTINUOUS_WORKER_BUSY" });
  assert.equal(await renewContinuousRadioLease(f.db, active), true);
  await assert.rejects(claimContinuousRadioLease(f.db, { ...active, workerId: "worker-instance-2", now: new Date(NOW.getTime() + 50000) }), { code: "CONTINUOUS_WORKER_BUSY" });
  assert.equal(await releaseContinuousRadioLease(f.db, { ...active, stopConfirmed: false }), true);
  assert.equal(f.data.config.lastError, "CONTINUOUS_STOP_UNCONFIRMED"); assert.equal(f.data.config.encoderLeaseOwner, active.leaseOwner);
  await assert.rejects(claimContinuousRadioLease(f.db, { ...active, workerId: "worker-instance-2", now: new Date(NOW.getTime() + 90000) }), { code: "CONTINUOUS_SOURCE_NOT_READY" });
});
test("durable STOP survives restart and works with broken source, rights and expired service", async () => {
  const f = fixture(), active = await running(f);
  f.data.tracks = []; f.data.config.sourcePort = 8393; f.data.station.organisation.subscription.currentPeriodEnd = BEFORE;
  assert.deepEqual(await stopContinuousRadio(f.db, f.options), { enabled: false, status: "STOP_REQUESTED" });
  await assert.rejects(renewContinuousRadioLease(f.db, active), { code: "CONTINUOUS_NOT_ENABLED" });
  await assert.rejects(loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }), { code: "CONTINUOUS_NOT_ENABLED" });
  assert.equal((await continuousRadioDashboard(f.db, f.options)).status, "STOPPING");
  assert.equal(await releaseContinuousRadioLease(f.db, active), true);
  assert.equal((await continuousRadioDashboard(f.db, f.options)).status, "STOPPED");
});
test("budget reservations count retries and survive a fresh grant, concurrent calls cannot overspend", async () => {
  const f = fixture(), active = await running(f);
  await Promise.all([reserveContinuousRadioBytes(f.db, { ...active, bytes: 960000 }), reserveContinuousRadioBytes(f.db, { ...active, bytes: 960000 })]);
  const id = "test-radio-continuous-budget-2026-10", row = f.data.audits.get(id);
  assert.equal(row.details.reservedBytes, 2016000);
  row.details.reservedBytes = P.monthlyReservedBytes - 1100000;
  const outcomes = await Promise.allSettled([reserveContinuousRadioBytes(f.db, { ...active, bytes: 960000 }), reserveContinuousRadioBytes(f.db, { ...active, bytes: 960000 })]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(result => result.status === "rejected").reason.code, "CONTINUOUS_BUDGET_EXHAUSTED");
  const used = f.data.audits.get(id).details.reservedBytes;
  await stopContinuousRadio(f.db, f.options); await releaseContinuousRadioLease(f.db, active);
  const fresh = await running(f);
  await assert.rejects(reserveContinuousRadioBytes(f.db, { ...fresh, bytes: 960000 }), { code: "CONTINUOUS_BUDGET_EXHAUSTED" });
  assert.equal(f.data.audits.get(id).details.reservedBytes, used);
});
test("title and Listen require positive actual audio, current lease and fresh observations", async () => {
  const f = fixture(), active = await running(f), trackId = f.data.tracks[0].id;
  assert.equal((await continuousRadioDashboard(f.db, f.options)).listening.enabled, false);
  await assert.rejects(recordContinuousRadioObservation(f.db, { ...active, state: "STREAMING", trackId, audioBytesSent: 0 }), { code: "CONTINUOUS_AUDIO_UNCONFIRMED" });
  await recordContinuousRadioObservation(f.db, { ...active, state: "STREAMING", trackId, audioBytesSent: 384 });
  let status = await continuousRadioDashboard(f.db, f.options);
  assert.equal(status.status, "STREAMING"); assert.equal(status.listening.listenerUrl, P.listenerUrl); assert.equal(status.listening.track.title, "Track 1");
  assert.equal(JSON.stringify(status).includes("ciphertext"), false); assert.equal(JSON.stringify(status).includes("sourceFingerprint"), false);
  status = await continuousRadioDashboard(f.db, { ...f.options, now: new Date(NOW.getTime() + 16000) });
  assert.equal(status.listening.enabled, false); assert.equal(status.listening.track, null);
  f.data.audits.get(CONTINUOUS_OBSERVATION_ID).details.observedAt = new Date(NOW.getTime() + 1000).toISOString();
  assert.equal((await continuousRadioDashboard(f.db, f.options)).listening.enabled, false);
  await stopContinuousRadio(f.db, f.options);
  assert.equal((await continuousRadioDashboard(f.db, f.options)).listening.enabled, false);
});
test("confirmed errors remain actionable after lease release, clear on restart and cannot reopen Listen", async () => {
  const f = fixture(), active = await running(f);
  await assert.rejects(recordContinuousRadioObservation(f.db, { ...active, state: "ERROR", reasonCode: "secret raw transport exception" }), { code: "CONTINUOUS_OBSERVATION_INVALID" });
  await recordContinuousRadioObservation(f.db, { ...active, state: "ERROR", reasonCode: "CONTINUOUS_BUDGET_EXHAUSTED" });
  await releaseContinuousRadioLease(f.db, active);
  let status = await continuousRadioDashboard(f.db, { ...f.options, now: new Date(NOW.getTime() + 120000) });
  assert.equal(status.status, "NEEDS_ATTENTION"); assert.equal(status.worker.ready, false);
  assert.equal(status.worker.state, "ERROR"); assert.equal(status.reasonCode, "CONTINUOUS_BUDGET_EXHAUSTED");
  assert.equal(status.label, "Monthly Test Radio budget reached; playback stopped.");
  assert.equal(status.listening.enabled, false); assert.equal(status.listening.track, null);
  const lease = await claimContinuousRadioLease(f.db, { ...active, workerId: "worker-instance-1" });
  await recordContinuousRadioObservation(f.db, { ...active, leaseOwner: lease.leaseOwner, state: "STARTING" });
  status = await continuousRadioDashboard(f.db, f.options);
  assert.equal(status.status, "STARTING"); assert.equal(status.reasonCode, null); assert.equal(status.attentionRequired, false);
  await recordContinuousRadioObservation(f.db, { ...active, state: "ERROR", reasonCode: "CONTINUOUS_OPERATION_FAILED" });
  assert.equal((await continuousRadioDashboard(f.db, f.options)).label, "Playback stopped and needs attention.");
  await releaseContinuousRadioLease(f.db, active); await stopContinuousRadio(f.db, f.options);
  status = await continuousRadioDashboard(f.db, f.options);
  assert.equal(status.status, "STOPPED"); assert.equal(status.reasonCode, null); assert.equal(status.attentionRequired, false);
  assert.equal(status.startAllowed, true);
});
